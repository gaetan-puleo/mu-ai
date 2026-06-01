import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';
import { lookup } from 'node:dns/promises';
import { type ContentPart, text, type Tool } from 'mu-core';
import { definePlugin } from 'mu-harness';
import TurndownService from 'turndown';

const formatError = (err: unknown): string => `Error: ${err instanceof Error ? err.message : String(err)}`;

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 100;
const MAX_REDIRECTS = 5;

const PRIVATE_BLOCKLIST = (() => {
  const bl = new BlockList();
  bl.addSubnet('0.0.0.0', 8, 'ipv4');
  bl.addSubnet('10.0.0.0', 8, 'ipv4');
  bl.addSubnet('100.64.0.0', 10, 'ipv4');
  bl.addSubnet('127.0.0.0', 8, 'ipv4');
  bl.addSubnet('169.254.0.0', 16, 'ipv4');
  bl.addSubnet('172.16.0.0', 12, 'ipv4');
  bl.addSubnet('192.168.0.0', 16, 'ipv4');
  bl.addAddress('255.255.255.255', 'ipv4');
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
const ACCEPT_HEADER = 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';

const WEBFETCH_SYSTEM_PROMPT = [
  '## webfetch',
  'Fetch a URL and return it as markdown.',
  '',
  '- Responses >5MB or slower than `timeout` (default 30s, max 120s) fail.',
  '- Image URLs return `data:<mime>;base64,…` — fetch sparingly; large images bloat context.',
].join('\n');

function parseCharsetFromContentType(contentType: string): string | undefined {
  const m = /charset\s*=\s*("([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType);
  if (!m) return undefined;
  return (m[2] ?? m[3] ?? m[4])?.trim();
}

function sniffCharsetFromHtmlMeta(buf: ArrayBuffer): string | undefined {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024)));
  const direct = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_:.\-]+)/i.exec(head);
  if (direct?.[1]) return direct[1].trim();
  const httpEquiv = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]+content\s*=\s*["']([^"']+)["']/i.exec(head);
  if (httpEquiv?.[1]) return parseCharsetFromContentType(httpEquiv[1]);
  return undefined;
}

function decodeWithCharset(buf: ArrayBuffer, label: string | undefined): string {
  if (label) {
    try {
      return new TextDecoder(label).decode(buf);
    } catch {
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

async function runWebFetch(args: WebFetchArgs, ctx?: { signal?: AbortSignal }): Promise<string> {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return formatError('url is required');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return formatError('URL must start with http:// or https://');
  }

  const timeoutPick = pickTimeoutMs(args.timeout);
  if (!timeoutPick.ok) return timeoutPick.error;
  const timeoutMs = timeoutPick.ms;
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const hostSignal = ctx?.signal;
  const onHostAbort = (): void => {
    const reason = hostSignal?.reason instanceof Error
      ? hostSignal.reason
      : new Error(typeof hostSignal?.reason === 'string' ? hostSignal.reason : 'Aborted by runtime');
    controller.abort(reason);
  };
  if (hostSignal) {
    if (hostSignal.aborted) {
      onHostAbort();
    } else {
      hostSignal.addEventListener('abort', onHostAbort, { once: true });
    }
  }

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
      const isHtml = contentType.includes('text/html');
      const headerCharset = parseCharsetFromContentType(contentType);
      const charset = headerCharset ?? (isHtml ? sniffCharsetFromHtmlMeta(buf) : undefined);
      const body = decodeWithCharset(buf, charset);
      return isHtml ? convertHtmlToMarkdown(body) : body;
    }
    return formatError(`Too many redirects (>${MAX_REDIRECTS}) starting from ${url}`);
  } finally {
    clearTimeout(timerId);
    hostSignal?.removeEventListener('abort', onHostAbort);
  }
}

export interface WebFetchArgs {
  url?: unknown;
  timeout?: unknown;
}

export { convertHtmlToMarkdown };

export function createWebFetchTool(): Tool {
  return {
    name: 'webfetch',
    description: 'Fetch a URL and return it as markdown.',
    prompt: WEBFETCH_SYSTEM_PROMPT,
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
    async run(input, ctx): Promise<ContentPart[]> {
      const args = (input ?? {}) as WebFetchArgs;
      try {
        return [text(await runWebFetch(args, ctx))];
      } catch (err) {
        return [text(formatError(err))];
      }
    },
  };
}

export default definePlugin({
  name: 'webfetch',
  tools: [createWebFetchTool()],
});
