import { chromium, type Browser } from 'playwright';
import { AppError } from '../../lib/errors.js';
import { BROWSER_LIKE_HEADERS, resolveAndCheckHost } from './url-security.js';

// After domcontentloaded, wait this long at most for the network to go idle
// so client-side-rendered content has a chance to land. Pages with long
// polling/analytics never settle, so a non-settling network is not an error -
// the DOM is taken as-is when this expires.
const NETWORK_IDLE_TIMEOUT_MS = 5000;

export interface BrowserFetchOptions {
  timeoutMs: number
  maxBytes: number
}

export interface BrowserFetchResult {
  html: string
  effectiveUrl: string
}

// Interface the pipeline depends on, so tests can inject a fake instead of
// launching Chromium (same pattern as GeminiCanonicalRecipeGenerator).
export interface BrowserHtmlFetcher {
  fetchWithBrowser(url: URL, opts: BrowserFetchOptions): Promise<BrowserFetchResult>
}

// Lazy singleton browser: launching Chromium costs ~1s, so it is started on
// first use and reused across requests. closeBrowser() is wired to process
// shutdown in the server entrypoint.
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

// Fetches a page with a real headless browser (full JS execution) for pages
// whose recipe content only exists after client-side rendering. The static
// path's SSRF guardrails are preserved via route interception: every request
// the page makes - the navigation itself, redirect hops, subresources, and
// XHR/fetch calls - has its hostname resolved and checked against the
// blocked-address list before it is allowed through.
export async function fetchWithBrowser(url: URL, opts: BrowserFetchOptions): Promise<BrowserFetchResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: BROWSER_LIKE_HEADERS['User-Agent'],
    extraHTTPHeaders: { 'Accept-Language': BROWSER_LIKE_HEADERS['Accept-Language'] },
  });

  try {
    const page = await context.newPage();

    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
        await route.abort();
        return;
      }
      try {
        await resolveAndCheckHost(requestUrl.hostname);
      } catch {
        await route.abort();
        return;
      }
      await route.continue();
    });

    const response = await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: opts.timeoutMs,
    });

    // Same bot-protection policy as the static fetch path: a challenge page
    // rarely resolves in a headless browser, so fail explicitly instead of
    // feeding a challenge shell to the extractor.
    if (response && (response.status() === 401 || response.status() === 403)) {
      throw new AppError(
        'URL_FETCH_BLOCKED',
        'This site blocks automated access. Copy the recipe into the Manual tab instead.',
        { status: response.status() },
      );
    }
    if (response && response.status() >= 400) {
      throw new AppError('URL_FETCH_FAILED', `The site returned an error (HTTP ${response.status()}).`, {
        status: response.status(),
      });
    }

    try {
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });
    } catch {
      // Network never went idle - take the DOM as-is.
    }

    const html = await page.content();
    if (Buffer.byteLength(html, 'utf-8') > opts.maxBytes) {
      throw new AppError('INVALID_INPUT', 'Response too large');
    }

    return { html, effectiveUrl: page.url() };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new AppError('URL_FETCH_TIMEOUT', 'Timed out while rendering the URL in a browser.');
    }
    throw err;
  } finally {
    await context.close();
  }
}

// Default production fetcher instance for dependency injection.
export const defaultBrowserHtmlFetcher: BrowserHtmlFetcher = { fetchWithBrowser };
