import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';
import { extractRecipeJsonLd } from './jsonld-extractor.js';

function wrap(...jsonBlocks: string[]): string {
  const scripts = jsonBlocks
    .map((block) => `<script type="application/ld+json">${block}</script>`)
    .join('\n');
  return `<html><head>${scripts}</head><body><p>page text</p></body></html>`;
}

const RECIPE_NODE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Overnight Oats',
  recipeIngredient: ['1 cup oats', '2 tbsp peanut butter'],
};

describe('extractRecipeJsonLd', () => {
  it('extracts a top-level Recipe object', () => {
    const root = parse(wrap(JSON.stringify(RECIPE_NODE)));
    expect(extractRecipeJsonLd(root)).toMatchObject({ name: 'Overnight Oats' });
  });

  it('extracts a Recipe from a top-level array', () => {
    const root = parse(wrap(JSON.stringify([{ '@type': 'WebSite' }, RECIPE_NODE])));
    expect(extractRecipeJsonLd(root)).toMatchObject({ name: 'Overnight Oats' });
  });

  it('extracts a Recipe from an @graph array', () => {
    const doc = { '@context': 'https://schema.org', '@graph': [{ '@type': 'BreadcrumbList' }, RECIPE_NODE] };
    const root = parse(wrap(JSON.stringify(doc)));
    expect(extractRecipeJsonLd(root)).toMatchObject({ name: 'Overnight Oats' });
  });

  it('matches "@type" given as an array of types', () => {
    const node = { ...RECIPE_NODE, '@type': ['Recipe', 'NewsArticle'] };
    const root = parse(wrap(JSON.stringify(node)));
    expect(extractRecipeJsonLd(root)).toMatchObject({ name: 'Overnight Oats' });
  });

  it('skips a malformed JSON block and finds the Recipe in a later block', () => {
    const root = parse(wrap('{not valid json', JSON.stringify(RECIPE_NODE)));
    expect(extractRecipeJsonLd(root)).toMatchObject({ name: 'Overnight Oats' });
  });

  it('returns null when no JSON-LD block contains a Recipe', () => {
    const root = parse(wrap(JSON.stringify({ '@type': 'NewsArticle' })));
    expect(extractRecipeJsonLd(root)).toBeNull();
  });

  it('returns null when the page has no JSON-LD at all', () => {
    const root = parse('<html><body><p>just text</p></body></html>');
    expect(extractRecipeJsonLd(root)).toBeNull();
  });
});
