/**
 * mu-webfetch — fetches the contents of a URL and returns it as markdown.
 * Adapted from opencode's `webfetch` tool
 * (sst/opencode @ dev, packages/opencode/src/tool/webfetch.ts).
 *
 * Differences vs. opencode:
 *  - mu's Tool has no native attachment channel, so image responses
 *    return a `data:<mime>;base64,...` URL inline as text.
 *  - Cloudflare retry uses `User-Agent: mu` (vs. `opencode`).
 */

import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';
import { lookup } from 'node:dns/promises';
import { formatError, parseArgs, type Plugin, type Tool } from 'mu-core';
import TurndownService from 'turndown';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 30_000; // 30 s
const MAX_TIMEOUT_MS = 120_000; // 2 min
const MIN_TIMEOUT_MS = 100; // below this an AbortController can fire before fetch starts
const MAX_REDIRECTS = 5;

// SSRF guard: any IP literal or DNS-resolved address must NOT fall in these
// ranges. The validator runs before every fetch and again on each redirect
// target. Known limitation: DNS rebinding (TOCTOU between lookup and fetch)
// is not mitigated; documented and accepted for this PR.
const PRIVATE_BLOCKLIST = (() => {
  const bl = new BlockList();
  // IPv4 — loopback, link-local (incl. cloud metadata 169.254.169.254), RFC1918, CGNAT, broadcast.
  bl.addSubnet('0.0.0.0', 8, 'ipv4');
  bl.addSubnet('10.0.0.0', 8, 'ipv4');
  bl.addSubnet('100.64.0.0', 10, 'ipv4');
  bl.addSubnet('127.0.0.0', 8, 'ipv4');
  bl.addSubnet('169.254.0.0', 16, 'ipv4');
  bl.addSubnet('172.16.0.0', 12, 'ipv4');
  bl.addSubnet('192.168.0.0', 16, 'ipv4');
  bl.addAddress('255.255.255.255', 'ipv4');
  // IPv6 — unspecified, loopback, unique-local, link-local, IPv4-mapped covered separately.
  bl.addAddress('::', 'ipv6');
  bl.addAddress('::1', 'ipv6');
  bl.addSubnet('fc00::', 7, 'ipv6');
  bl.addSubnet('fe80::', 10, 'ipv6');
  return bl;
})();

function stripIPv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function stripZoneId(addr: string): string {
  const i = addr.indexOf('%');
  return i === -1 ? addr : addr.slice(0, i);
}

// IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract the embedded IPv4 so the v4 blocklist applies.
function mappedIPv4(addr: string): string | undefined {
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(addr);
  return m ? m[1] : undefined;
}

function isBlockedIp(addr: string): boolean {
  const clean = stripZoneId(addr);
  const v4 = mappedIPv4(clean);
  if (v4 && isIPv4(v4)) return PRIVATE_BLOCKLIST.check(v4, 'ipv4');
  if (isIPv4(clean)) return PRIVATE_BLOCKLIST.check(clean, 'ipv4');
  if (isIPv6(clean)) return PRIVATE_BLOCKLIST.check(clean, 'ipv6');
  return false;
}

type UrlCheck = { ok: true } | { ok: false; error: string };

async function assertSafeUrl(target: string): Promise<UrlCheck> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, error: formatError(`invalid URL: ${target}`) };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: formatError('URL must start with http:// or https://') };
  }
  const host = stripIPv6Brackets(parsed.hostname).toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, error: formatError(`refusing to fetch internal host: ${parsed.hostname}`) };
  }
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) {
      return { ok: false, error: formatError(`refusing to fetch internal address: ${parsed.hostname}`) };
    }
    return { ok: true };
  }
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) {
      return { ok: false, error: formatError(`could not resolve host: ${parsed.hostname}`) };
    }
    for (const a of addrs) {
      if (isBlockedIp(a.address)) {
        return {
          ok: false,
          error: formatError(`refusing to fetch ${parsed.hostname}: resolves to internal address ${a.address}`),
        };
      }
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: formatError(`DNS lookup failed for ${parsed.hostname}: ${message}`) };
  }
}
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const UA_RETRY = 'mu';
const ACCEPT_HEADER =
  'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';

const WEBFETCH_SYSTEM_PROMPT = [
  '## webfetch',
  'Fetch a URL and return it as markdown.',
  '',
  '- Responses >5MB or slower than `timeout` (default 30s, max 120s) fail.',
  '- Image URLs return `data:<mime>;base64,…` — fetch sparingly; large images bloat context.',
].join('\n');

// Extract `charset=...` from a Content-Type header value. Returns the raw,
// possibly-quoted token (e.g. `utf-8`, `"GB2312"`) or undefined.
function parseCharsetFromContentType(contentType: string): string | undefined {
  const m = /charset\s*=\s*("([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType);
  if (!m) return undefined;
  return (m[2] ?? m[3] ?? m[4])?.trim();
}

// Sniff `<meta charset="...">` or `<meta http-equiv="Content-Type" content="...; charset=...">`
// from the first ~1024 bytes of an HTML response. We decode as ASCII (safe for
// the meta tag itself) so we don't need a working decoder before we know the
// charset.
function sniffCharsetFromHtmlMeta(buf: ArrayBuffer): string | undefined {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024)));
  // <meta charset="...">
  const direct = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_:.\-]+)/i.exec(head);
  if (direct?.[1]) return direct[1].trim();
  // <meta http-equiv="Content-Type" content="...; charset=...">
  const httpEquiv = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]+content\s*=\s*["']([^"']+)["']/i.exec(head);
  if (httpEquiv?.[1]) return parseCharsetFromContentType(httpEquiv[1]);
  return undefined;
}

// TextDecoder accepts many labels (utf-8, utf8, UTF_8, etc.) but throws on
// unknown ones. Try the candidate, then fall back to UTF-8.
function decodeWithCharset(buf: ArrayBuffer, label: string | undefined): string {
  if (label) {
    try {
      return new TextDecoder(label).decode(buf);
    } catch {
      // Unknown label — fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(buf);
}

const TURNDOWN_OPTIONS: TurndownService.Options = {
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
};

function convertHtmlToMarkdown(html: string): string {
  const td = new TurndownService(TURNDOWN_OPTIONS);
  td.remove(['script', 'style', 'meta', 'link']);
  try {
    return td.turndown(html);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return formatError(`failed to convert HTML to markdown: ${message}`);
  }
}

type TimeoutPick = { ok: true; ms: number } | { ok: false; error: string };

function pickTimeoutMs(value: unknown): TimeoutPick {
  const seconds = typeof value === 'number' ? value : DEFAULT_TIMEOUT_MS / 1000;
  const requestedMs = seconds * 1000;
  if (!Number.isFinite(requestedMs) || requestedMs < MIN_TIMEOUT_MS) {
    return { ok: false, error: formatError(`timeout must be at least ${MIN_TIMEOUT_MS / 1000}s`) };
  }
  return { ok: true, ms: Math.min(requestedMs, MAX_TIMEOUT_MS) };
}

type FetchAttempt = { ok: true; response: Response } | { ok: false; error: string };

async function fetchWithCloudflareRetry(
  url: string,
  fetchSignal: AbortSignal,
  timeoutMs: number,
): Promise<FetchAttempt> {
  const headers = {
    'User-Agent': UA_BROWSER,
    Accept: ACCEPT_HEADER,
    'Accept-Language': 'en-US,en;q=0.9',
  };
  const attempt = async (h: Record<string, string>): Promise<FetchAttempt> => {
    try {
      // `redirect: 'manual'` so we can validate each Location target against the SSRF blocklist
      // before following. Without this, a public URL could 302 to http://169.254.169.254/.
      return {
        ok: true,
        response: await fetch(url, { signal: fetchSignal, headers: h, redirect: 'manual' }),
      };
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        return {
          ok: false,
          error: formatError(`Error fetching ${url}: request timed out after ${Math.round(timeoutMs)}ms`),
        };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: formatError(`Error fetching ${url}: ${message}`) };
    }
  };

  const first = await attempt(headers);
  if (!first.ok) return first;
  if (first.response.status === 403 && first.response.headers.get('cf-mitigated') === 'challenge') {
    // Drain the prior body so undici/Bun release the socket before the retry.
    await first.response.body?.cancel().catch(() => {});
    return attempt({ ...headers, 'User-Agent': UA_RETRY });
  }
  return first;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

type BoundedRead = { ok: true; buf: ArrayBuffer } | { ok: false; error: string };

async function readBoundedBuffer(response: Response): Promise<BoundedRead> {
  const declaredLen = response.headers.get('content-length');
  if (declaredLen && Number.parseInt(declaredLen, 10) > MAX_RESPONSE_SIZE) {
    return { ok: false, error: formatError('Response too large (exceeds 5MB limit)') };
  }
  if (!response.body) {
    const buf = await response.arrayBuffer();
    return buf.byteLength > MAX_RESPONSE_SIZE
      ? { ok: false, error: formatError('Response too large (exceeds 5MB limit)') }
      : { ok: true, buf };
  }
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  for await (const chunk of response.body) {
    totalSize += chunk.byteLength;
    if (totalSize > MAX_RESPONSE_SIZE) {
      return { ok: false, error: formatError('Response too large (exceeds 5MB limit)') };
    }
    chunks.push(chunk);
  }
  const buf = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, buf: buf.buffer };
}

async function runWebFetch(args: Record<string, unknown>): Promise<string> {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return formatError('url is required');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return formatError('URL must start with http:// or https://');
  }

  const timeoutPick = pickTimeoutMs(args.timeout);
  if (!timeoutPick.ok) return timeoutPick.error;
  const timeoutMs = timeoutPick.ms;
  // TODO: mu-core's Tool.execute signature doesn't pass an AbortSignal yet — when
  // it does, combine the executor signal with this timeout via AbortSignal.any().
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safe = await assertSafeUrl(currentUrl);
      if (!safe.ok) return safe.error;

      const attempt = await fetchWithCloudflareRetry(currentUrl, controller.signal, timeoutMs);
      if (!attempt.ok) return attempt.error;
      const { response } = attempt;

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) {
          return formatError(`Redirect from ${currentUrl} missing Location header`);
        }
        if (hop === MAX_REDIRECTS) {
          return formatError(`Too many redirects (>${MAX_REDIRECTS}) starting from ${url}`);
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return formatError(`Redirect from ${currentUrl} has invalid Location: ${location}`);
        }
        continue;
      }

      if (!response.ok) {
        // Drain the body so undici/Bun release the socket instead of waiting for GC.
        await response.body?.cancel().catch(() => {});
        return formatError(`Failed to fetch ${currentUrl}: ${response.status} ${response.statusText}`);
      }

      const bounded = await readBoundedBuffer(response);
      if (!bounded.ok) return bounded.error;
      const { buf } = bounded;

      const contentType = response.headers.get('content-type') ?? '';
      const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();

      if (mime.startsWith('image/') && !mime.endsWith('+xml') && mime !== 'image/vnd.microsoft.icon') {
        const base64 = Buffer.from(buf).toString('base64');
        return `[image: ${mime}, ${buf.byteLength} bytes from ${currentUrl}]\ndata:${mime};base64,${base64}`;
      }
      // Charset: prefer the `Content-Type` header, fall back to `<meta charset>`
      // for HTML, then UTF-8. Unknown labels also fall back to UTF-8.
      const isHtml = contentType.includes('text/html');
      const headerCharset = parseCharsetFromContentType(contentType);
      const charset = headerCharset ?? (isHtml ? sniffCharsetFromHtmlMeta(buf) : undefined);
      const body = decodeWithCharset(buf, charset);
      return isHtml ? convertHtmlToMarkdown(body) : body;
    }
    return formatError(`Too many redirects (>${MAX_REDIRECTS}) starting from ${url}`);
  } finally {
    clearTimeout(timerId);
  }
}

export function createWebFetchTool(): Tool {
  return {
    name: 'webfetch',
    description: 'Fetch a URL and return it as markdown.',
    systemPrompt: WEBFETCH_SYSTEM_PROMPT,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Fully-formed http:// or https:// URL.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (max 120).',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execute(args) {
      return runWebFetch(parseArgs(args));
    },
    onError: formatError,
  };
}

const webFetchPlugin: Plugin = {
  name: 'webfetch',
  tools: { webfetch: createWebFetchTool() },
};

export default webFetchPlugin;
