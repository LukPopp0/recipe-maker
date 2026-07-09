import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';

vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

const OPTS = { timeoutMs: 10000, maxBytes: 1_000_000 };

describe('fetchWithBrowser', () => {
  let routeHandler: ((route: unknown) => Promise<void>) | undefined;
  let page: {
    route: ReturnType<typeof vi.fn>
    goto: ReturnType<typeof vi.fn>
    waitForLoadState: ReturnType<typeof vi.fn>
    content: ReturnType<typeof vi.fn>
    url: ReturnType<typeof vi.fn>
  };
  let context: { newPage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let browser: { newContext: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    routeHandler = undefined;
    page = {
      route: vi.fn(async (_pattern: string, handler: (route: unknown) => Promise<void>) => {
        routeHandler = handler;
      }),
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue('<html>ok</html>'),
      url: vi.fn().mockReturnValue('https://example.com/final'),
    };
    context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(chromium.launch).mockReset().mockResolvedValue(browser as never);
    // Default: resolve any hostname to a public IP.
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  });

  afterEach(async () => {
    const { closeBrowser } = await import('./browser-fetcher.js');
    await closeBrowser();
    vi.restoreAllMocks();
  });

  it('happy path returns html and effective url, closes context', async () => {
    const { fetchWithBrowser } = await import('./browser-fetcher.js');
    const result = await fetchWithBrowser(new URL('https://example.com/recipe'), OPTS);
    expect(result).toEqual({ html: '<html>ok</html>', effectiveUrl: 'https://example.com/final' });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('maps a TimeoutError from goto to URL_FETCH_TIMEOUT and still closes context', async () => {
    const { fetchWithBrowser } = await import('./browser-fetcher.js');
    page.goto.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));

    await expect(fetchWithBrowser(new URL('https://example.com/recipe'), OPTS)).rejects.toMatchObject({
      code: 'URL_FETCH_TIMEOUT',
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('maps a 403 response to URL_FETCH_BLOCKED with status detail', async () => {
    const { fetchWithBrowser } = await import('./browser-fetcher.js');
    page.goto.mockResolvedValue({ status: () => 403 });

    await expect(fetchWithBrowser(new URL('https://example.com/recipe'), OPTS)).rejects.toMatchObject({
      code: 'URL_FETCH_BLOCKED',
      details: { status: 403 },
    });
  });

  it('maps a 500 response to URL_FETCH_FAILED', async () => {
    const { fetchWithBrowser } = await import('./browser-fetcher.js');
    page.goto.mockResolvedValue({ status: () => 500 });

    await expect(fetchWithBrowser(new URL('https://example.com/recipe'), OPTS)).rejects.toMatchObject({
      code: 'URL_FETCH_FAILED',
    });
  });

  it('swallows a waitForLoadState rejection and still returns html', async () => {
    const { fetchWithBrowser } = await import('./browser-fetcher.js');
    page.waitForLoadState.mockRejectedValue(new Error('network never idle'));

    const result = await fetchWithBrowser(new URL('https://example.com/recipe'), OPTS);
    expect(result.html).toBe('<html>ok</html>');
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 5000 });
  });

  it('rejects with INVALID_INPUT when content exceeds maxBytes', async () => {
    const { fetchWithBrowser } = await import('./browser-fetcher.js');
    page.content.mockResolvedValue('x'.repeat(20));

    await expect(fetchWithBrowser(new URL('https://example.com/recipe'), { timeoutMs: 10000, maxBytes: 10 })).rejects.toMatchObject(
      { code: 'INVALID_INPUT' },
    );
  });

  describe('route interception (SSRF guard)', () => {
    function fakeRoute(url: string) {
      return {
        request: () => ({ url: () => url }),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('aborts non-http(s) protocols', async () => {
      const { fetchWithBrowser } = await import('./browser-fetcher.js');
      await fetchWithBrowser(new URL('https://example.com/recipe'), OPTS);
      expect(routeHandler).toBeDefined();

      const route = fakeRoute('ftp://example.com/file');
      await routeHandler!(route);
      expect(route.abort).toHaveBeenCalledTimes(1);
      expect(route.continue).not.toHaveBeenCalled();
    });

    it('aborts hosts that resolve to a blocked address', async () => {
      const { fetchWithBrowser } = await import('./browser-fetcher.js');
      await fetchWithBrowser(new URL('https://example.com/recipe'), OPTS);
      expect(routeHandler).toBeDefined();

      vi.mocked(dns.promises.lookup).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
      const route = fakeRoute('https://internal.example.com/');
      await routeHandler!(route);
      expect(route.abort).toHaveBeenCalledTimes(1);
      expect(route.continue).not.toHaveBeenCalled();
    });

    it('continues hosts that resolve to a public address', async () => {
      const { fetchWithBrowser } = await import('./browser-fetcher.js');
      await fetchWithBrowser(new URL('https://example.com/recipe'), OPTS);
      expect(routeHandler).toBeDefined();

      const route = fakeRoute('https://public.example.com/');
      await routeHandler!(route);
      expect(route.continue).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });
  });

  it('launches chromium once and reuses the browser across calls; relaunches after closeBrowser', async () => {
    const { fetchWithBrowser, closeBrowser } = await import('./browser-fetcher.js');

    await fetchWithBrowser(new URL('https://example.com/a'), OPTS);
    await fetchWithBrowser(new URL('https://example.com/b'), OPTS);
    expect(chromium.launch).toHaveBeenCalledTimes(1);

    await closeBrowser();
    expect(browser.close).toHaveBeenCalledTimes(1);

    await fetchWithBrowser(new URL('https://example.com/c'), OPTS);
    expect(chromium.launch).toHaveBeenCalledTimes(2);
  });
});
