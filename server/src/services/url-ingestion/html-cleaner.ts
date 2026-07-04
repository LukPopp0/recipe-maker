import { parse, type HTMLElement } from 'node-html-parser';
import { extractRecipeJsonLd } from './jsonld-extractor.js';

const MAX_CANDIDATE_IMAGES = 10;
const TAGS_TO_STRIP = ['script', 'style', 'noscript'];

// Block-level tags after which a text boundary must be inserted before text
// extraction. node-html-parser's innerText/.text concatenate text nodes with
// no separator, so compact/minified HTML like `<li>Flour</li><li>Water</li>`
// (no literal whitespace between tags) would otherwise glue adjacent
// elements' text together (e.g. "FlourWater").
const BLOCK_TAGS = [
  'p', 'div', 'li', 'br', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'article', 'section', 'header', 'footer', 'nav', 'aside', 'main',
  'ul', 'ol', 'table', 'blockquote', 'pre', 'form',
  'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'hr',
];

export interface CleanedHtml {
  cleanedText: string
  candidateImageUrls: string[]
  titleHint: string | null
  // Raw schema.org Recipe node from a <script type="application/ld+json">
  // block, when the page embeds one. Serialized length counts against the
  // character budget ahead of cleanedText, since it is the denser and more
  // authoritative extraction input.
  recipeJsonLd: Record<string, unknown> | null
}

// Collapses runs of whitespace (including newlines/tabs) into single spaces
// and trims the ends, so extracted text is safe to feed to Gemini without
// wasting the character budget on formatting artifacts.
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Removes elements that never contribute visible text (script/style/noscript)
// and HTML comments, mutating the parsed tree in place.
function stripNonVisibleNodes(root: HTMLElement): void {
  for (const tag of TAGS_TO_STRIP) {
    for (const el of root.querySelectorAll(tag)) {
      el.remove();
    }
  }
  // node-html-parser keeps comments out of text extraction already, but
  // strip any literal comment nodes so they can never leak into innerText.
  root.querySelectorAll('*').forEach((el) => {
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 8 /* COMMENT_NODE */) {
        child.remove();
      }
    }
  });
}

// Inserts a single-space text boundary immediately after every block-level
// element so text from separate elements never gets concatenated without a
// separator during subsequent .innerText/.text extraction. collapseWhitespace
// normalizes any doubled-up spacing this produces (e.g. around nested tags).
function insertBlockBoundaries(root: HTMLElement): void {
  const selector = BLOCK_TAGS.join(', ');
  for (const el of root.querySelectorAll(selector)) {
    el.insertAdjacentHTML('afterend', ' ');
  }
}

// Picks the block of visible text to run truncation over, preferring (in
// order) <article>, <main>, the largest <div> by text length, and finally
// the full body text when none of those are present.
function selectPrimaryTextBlock(root: HTMLElement): string {
  const body = root.querySelector('body') ?? root;

  const article = body.querySelector('article');
  if (article) return collapseWhitespace(article.innerText);

  const main = body.querySelector('main');
  if (main) return collapseWhitespace(main.innerText);

  let largestDiv: HTMLElement | null = null;
  let largestLength = 0;
  for (const div of body.querySelectorAll('div')) {
    const length = collapseWhitespace(div.innerText).length;
    if (length > largestLength) {
      largestDiv = div;
      largestLength = length;
    }
  }
  if (largestDiv) return collapseWhitespace(largestDiv.innerText);

  return collapseWhitespace(body.innerText);
}

// Resolves a possibly-relative URL string against the effective page URL.
// Returns null for values that cannot be resolved to a usable absolute URL.
function resolveUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

// Collects og:image / twitter:image meta content and <img src> values,
// resolves them to absolute URLs against baseUrl, dedupes, and caps at 10.
function extractCandidateImageUrls(root: HTMLElement, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (raw: string | null | undefined) => {
    if (urls.length >= MAX_CANDIDATE_IMAGES) return;
    const resolved = resolveUrl(raw, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    urls.push(resolved);
  };

  for (const meta of root.querySelectorAll('meta')) {
    const property = meta.getAttribute('property') ?? meta.getAttribute('name');
    if (property === 'og:image' || property === 'twitter:image') {
      addUrl(meta.getAttribute('content'));
    }
  }

  for (const img of root.querySelectorAll('img')) {
    addUrl(img.getAttribute('src'));
  }

  return urls.slice(0, MAX_CANDIDATE_IMAGES);
}

// Extracts a title hint from <title> or, failing that, og:title meta content.
function extractTitleHint(root: HTMLElement): string | null {
  const titleEl = root.querySelector('title');
  const titleText = titleEl ? collapseWhitespace(titleEl.text) : '';
  if (titleText) return titleText;

  const ogTitle = root.querySelector('meta[property="og:title"]');
  const ogTitleText = ogTitle ? collapseWhitespace(ogTitle.getAttribute('content') ?? '') : '';
  if (ogTitleText) return ogTitleText;

  return null;
}

// Parses raw HTML fetched from a recipe URL into inputs for the Gemini
// extraction prompt: cleaned visible text (truncated to a character budget
// standing in for GEMINI_TOKEN_BUDGET), candidate image URLs, and a title
// hint. Never throws - malformed or empty HTML degrades to empty results.
export function cleanHtmlForExtraction(
  html: string,
  tokenBudgetChars: number,
  baseUrl: string,
): CleanedHtml {
  let root: HTMLElement;
  try {
    root = parse(html ?? '');
  } catch {
    return { cleanedText: '', candidateImageUrls: [], titleHint: null, recipeJsonLd: null };
  }

  const titleHint = extractTitleHint(root);
  const candidateImageUrls = extractCandidateImageUrls(root, baseUrl);

  // JSON-LD must be read before stripNonVisibleNodes removes script tags.
  const recipeJsonLd = extractRecipeJsonLd(root);

  stripNonVisibleNodes(root);
  insertBlockBoundaries(root);
  const primaryText = selectPrimaryTextBlock(root);

  // JSON-LD gets first claim on the character budget; visible text fills the
  // remainder so the combined prompt input stays within tokenBudgetChars.
  const jsonLdChars = recipeJsonLd ? JSON.stringify(recipeJsonLd).length : 0;
  const textBudget = Math.max(tokenBudgetChars - jsonLdChars, 0);
  const cleanedText = primaryText.slice(0, Math.max(textBudget, 0));

  return { cleanedText, candidateImageUrls, titleHint, recipeJsonLd };
}
