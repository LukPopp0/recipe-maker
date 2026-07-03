import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  fetchWithGuardrails,
  isBlockedAddress,
  resolveAndCheckHost,
  validateUrlSyntax,
} from './url-security.js';

describe('validateUrlSyntax', () => {
  it('parses a valid http(s) URL', () => {
    expect(validateUrlSyntax('https://example.com/recipe').href).toBe(
      'https://example.com/recipe',
    );
    expect(validateUrlSyntax('http://example.com').protocol).toBe('http:');
  });

  it('rejects malformed input', () => {
    expect(() => validateUrlSyntax('not a url')).toThrow(AppError);
    try {
      validateUrlSyntax('not a url');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_URL');
    }
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => validateUrlSyntax('ftp://example.com/file')).toThrow(AppError);
    try {
      validateUrlSyntax('ftp://example.com/file');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_URL');
    }
  });
});

describe('isBlockedAddress', () => {
  it('blocks IPv4 loopback', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.255.255.255')).toBe(true);
  });

  it('blocks IPv4 private ranges', () => {
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
  });

  it('does not block adjacent public-looking 172 ranges', () => {
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
  });

  it('blocks IPv4 link-local, including the cloud metadata endpoint', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('169.254.0.1')).toBe(true);
  });

  it('blocks the unspecified IPv4 address', () => {
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
  });

  it('allows a public IPv4 address', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
  });

  it('blocks IPv6 loopback and unspecified', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::')).toBe(true);
  });

  it('blocks IPv6 unique local (private) addresses', () => {
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456:789a::1')).toBe(true);
  });

  it('blocks IPv6 link-local addresses', () => {
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('febf::1')).toBe(true);
  });

  it('does not block adjacent public-looking IPv6 addresses', () => {
    expect(isBlockedAddress('fec0::1')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('blocks IPv4-mapped IPv6 addresses embedding a blocked IPv4 address', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::FFFF:10.0.0.5')).toBe(true); // case-insensitive on ffff
    expect(isBlockedAddress('0:0:0:0:0:ffff:127.0.0.1')).toBe(true); // fully-expanded form
  });

  it('does not block IPv4-mapped IPv6 addresses embedding a public IPv4 address', () => {
    expect(isBlockedAddress('::ffff:93.184.216.34')).toBe(false);
  });
});

describe('resolveAndCheckHost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a literal blocked IPv4 hostname without a DNS lookup', async () => {
    const lookupSpy = vi.spyOn(dns.promises, 'lookup');
    await expect(resolveAndCheckHost('127.0.0.1')).rejects.toThrow(AppError);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('rejects http://localhost when it resolves to a loopback address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
    ] as never);
    await expect(resolveAndCheckHost('localhost')).rejects.toThrow(AppError);
  });

  it('rejects the cloud metadata endpoint literal IP', async () => {
    await expect(resolveAndCheckHost('169.254.169.254')).rejects.toThrow(AppError);
  });

  it('rejects a literal private IP', async () => {
    await expect(resolveAndCheckHost('10.0.0.5')).rejects.toThrow(AppError);
  });

  it('rejects a hostname that resolves to a blocked address among several', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(resolveAndCheckHost('example.com')).rejects.toThrow(AppError);
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    await expect(resolveAndCheckHost('example.com')).resolves.toBeUndefined();
  });

  it('rejects a hostname that resolves only to an IPv4-mapped IPv6 AAAA record for a blocked address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '::ffff:169.254.169.254', family: 6 },
    ] as never);
    await expect(resolveAndCheckHost('evil.example.com')).rejects.toThrow(AppError);
  });
});

describe('fetchWithGuardrails', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  function textResponse(body: string, init?: ResponseInit) {
    return new Response(body, init);
  }

  it('returns the html and effective URL on a plain 200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(textResponse('<html>ok</html>'));

    const result = await fetchWithGuardrails(new URL('https://example.com/recipe'), {
      timeoutMs: 1000,
      maxRedirects: 3,
      maxBytes: 1_000_000,
    });

    expect(result.html).toBe('<html>ok</html>');
    expect(result.effectiveUrl).toBe('https://example.com/recipe');
  });

  it('follows a redirect chain within the limit and re-validates each hop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://example.com/next' } }),
      )
      .mockResolvedValueOnce(textResponse('<html>final</html>'));
    globalThis.fetch = fetchMock;

    const result = await fetchWithGuardrails(new URL('https://example.com/start'), {
      timeoutMs: 1000,
      maxRedirects: 3,
      maxBytes: 1_000_000,
    });

    expect(result.html).toBe('<html>final</html>');
    expect(result.effectiveUrl).toBe('https://example.com/next');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect that points at a blocked address', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
      );

    await expect(
      fetchWithGuardrails(new URL('https://example.com/start'), {
        timeoutMs: 1000,
        maxRedirects: 3,
        maxBytes: 1_000_000,
      }),
    ).rejects.toThrow(AppError);
  });

  it('throws AppError INVALID_URL when a redirect has an unparseable Location header', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://[not-valid-ipv6' } }),
      );

    await expect(
      fetchWithGuardrails(new URL('https://example.com/start'), {
        timeoutMs: 1000,
        maxRedirects: 3,
        maxBytes: 1_000_000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('throws when the redirect chain exceeds maxRedirects', async () => {
    let hop = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      hop += 1;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/hop-${hop}` },
        }),
      );
    });

    await expect(
      fetchWithGuardrails(new URL('https://example.com/start'), {
        timeoutMs: 1000,
        maxRedirects: 2,
        maxBytes: 1_000_000,
      }),
    ).rejects.toMatchObject({ code: 'URL_FETCH_TIMEOUT' });
  });

  it('throws INVALID_INPUT when the response exceeds maxBytes', async () => {
    const bigBody = 'x'.repeat(1000);
    globalThis.fetch = vi.fn().mockResolvedValue(textResponse(bigBody));

    await expect(
      fetchWithGuardrails(new URL('https://example.com/recipe'), {
        timeoutMs: 1000,
        maxRedirects: 3,
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('throws URL_FETCH_TIMEOUT when the fetch does not complete in time', async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    await expect(
      fetchWithGuardrails(new URL('https://example.com/recipe'), {
        timeoutMs: 10,
        maxRedirects: 3,
        maxBytes: 1_000_000,
      }),
    ).rejects.toMatchObject({ code: 'URL_FETCH_TIMEOUT' });
  });
});
