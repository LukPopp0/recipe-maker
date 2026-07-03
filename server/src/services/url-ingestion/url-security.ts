import dns from 'node:dns';
import net from 'node:net';
import { AppError } from '../../lib/errors.js';

// Parses and validates a raw URL string: must be well-formed and use the
// http or https scheme. Any other scheme (ftp:, file:, data:, etc.) or
// malformed input is rejected so the pipeline can never be pointed at
// non-HTTP resources.
export function validateUrlSyntax(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('INVALID_URL', 'The provided URL is malformed.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_URL', 'Only http and https URLs are supported.');
  }

  return url;
}

// Expands a compact IPv6 address (with optional "::" abbreviation) into its
// 8 hextet groups, so range checks can inspect the leading bits directly.
function expandIpv6Groups(ip: string): number[] {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  return groups.map((g) => parseInt(g || '0', 16));
}

// Checks whether an IPv4 address falls into a loopback, private, link-local,
// or unspecified range. Shared by isBlockedAddress for both plain IPv4
// addresses and the IPv4 address embedded in an IPv4-mapped IPv6 address.
function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  const [a, b] = octets;
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (ip === '0.0.0.0') return true; // unspecified
  return false;
}

// Matches an IPv4-mapped IPv6 address in either its canonical compressed
// form (::ffff:a.b.c.d) or fully-expanded form (0:0:0:0:0:ffff:a.b.c.d),
// case-insensitive on the "ffff" hextet, and captures the embedded IPv4
// address so it can be checked against the IPv4 blocklist.
const IPV4_MAPPED_IPV6_PATTERN = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

// Checks whether an IPv4 or IPv6 address falls into a loopback, private,
// link-local, or unspecified range - the ranges that must never be reachable
// via a server-side URL fetch (SSRF protection, including cloud metadata
// endpoints like 169.254.169.254).
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }

  if (net.isIPv6(ip)) {
    if (ip === '::1') return true; // loopback
    if (ip === '::') return true; // unspecified

    // IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1) embed a real IPv4
    // address that must go through the same blocklist - otherwise this form
    // is a bypass for every IPv4 range check above.
    const mappedMatch = ip.match(IPV4_MAPPED_IPV6_PATTERN);
    if (mappedMatch) {
      return isBlockedIpv4(mappedMatch[1]);
    }

    const [first] = expandIpv6Groups(ip);
    if ((first & 0xfe00) === 0xfc00) return true; // private fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    return false;
  }

  return false;
}

// Resolves a hostname (or literal IP) and rejects it if it points at a
// blocked network address. Must be called before every fetch - including
// redirect targets - to prevent SSRF and DNS-rebinding style bypasses.
export async function resolveAndCheckHost(hostname: string): Promise<void> {
  if (net.isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new AppError('INVALID_URL', 'URL resolves to a blocked network address');
    }
    return;
  }

  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (addresses.some((addr) => isBlockedAddress(addr.address))) {
    throw new AppError('INVALID_URL', 'URL resolves to a blocked network address');
  }
}

type FetchGuardrailOptions = {
  timeoutMs: number
  maxRedirects: number
  maxBytes: number
}

type FetchGuardrailResult = {
  html: string
  effectiveUrl: string
}

// Reads a response body into a Buffer via a streaming reader, enforcing
// maxBytes so a malicious or misconfigured server can't exhaust memory with
// an unbounded or oversized response. Exported so any caller that needs raw
// bytes (e.g. binary image downloads, not just HTML text) can reuse the same
// streaming/size-limit logic instead of buffering via response.arrayBuffer().
export async function readBodyBytesWithLimit(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      controller.abort();
      throw new AppError('INVALID_INPUT', 'Response too large');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

// Text-body variant of readBodyBytesWithLimit, used for HTML page fetches.
async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<string> {
  const buffer = await readBodyBytesWithLimit(response, maxBytes, controller);
  return buffer.toString('utf-8');
}

// Fetches a URL with SSRF guardrails applied throughout the request
// lifecycle: the initial URL (and every redirect target) is re-validated and
// re-resolved before being fetched, a hard timeout bounds the whole request,
// redirects are capped at maxRedirects, and the body is streamed with a
// maxBytes limit. Validating the initial URL here too (not just redirects)
// means SSRF protection does not depend on callers remembering to validate
// before invoking this function.
export async function fetchWithGuardrails(
  url: URL,
  opts: FetchGuardrailOptions,
): Promise<FetchGuardrailResult> {
  const validatedUrl = validateUrlSyntax(url.toString());
  await resolveAndCheckHost(validatedUrl.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    let currentUrl = validatedUrl;
    let redirectCount = 0;

    while (true) {
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        redirectCount += 1;
        if (redirectCount > opts.maxRedirects) {
          throw new AppError('URL_FETCH_TIMEOUT', 'Too many redirects while fetching the URL.');
        }

        const location = response.headers.get('location');
        if (!location) {
          throw new AppError('INVALID_URL', 'Redirect response is missing a Location header.');
        }

        let resolvedLocation: URL;
        try {
          resolvedLocation = new URL(location, currentUrl);
        } catch {
          throw new AppError('INVALID_URL', 'Redirect Location header is malformed.');
        }

        const nextUrl = validateUrlSyntax(resolvedLocation.toString());
        await resolveAndCheckHost(nextUrl.hostname);
        currentUrl = nextUrl;
        continue;
      }

      const html = await readBodyWithLimit(response, opts.maxBytes, controller);
      return { html, effectiveUrl: currentUrl.toString() };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('URL_FETCH_TIMEOUT', 'Timed out while fetching the URL.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
