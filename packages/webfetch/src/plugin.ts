/**
 * mu-webfetch — fetches the contents of a URL and returns it formatted as
 * markdown (default), plain text, or raw HTML. Adapted from opencode's
 * `webfetch` tool (sst/opencode @ dev, packages/opencode/src/tool/webfetch.ts).
 *
 * Differences vs. opencode:
 *  - mu's Tool has no native attachment channel, so image responses
 *    return a `data:<mime>;base64,...` URL inline as text.
 *  - HTML→text uses HTMLRewriter when available with a regex fallback.
 *  - Cloudflare retry uses `User-Agent: mu` (vs. `opencode`).
 */

import { formatError, parseArgs, type Plugin, type Tool } from 'mu-core';
import TurndownService from 'turndown';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 30_000; // 30 s
const MAX_TIMEOUT_MS = 120_000; // 2 min
const MIN_TIMEOUT_MS = 100; // below this an AbortController can fire before fetch starts
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const UA_RETRY = 'mu';

type WebFetchFormat = 'text' | 'markdown' | 'html';

const WEBFETCH_SYSTEM_PROMPT = [
  '## webfetch',
  'Fetch a URL and return it as markdown (default), text, or html.',
  '',
  '- Responses >5MB or slower than `timeout` (default 30s, max 120s) fail.',
  '- Image URLs return `data:<mime>;base64,…` — fetch sparingly; large images bloat context.',
].join('\n');

function buildAcceptHeader(format: WebFetchFormat): string {
  switch (format) {
    case 'markdown':
      return 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';
    case 'text':
      return 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
    case 'html':
      return 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1';
    default:
      return '*/*';
  }
}

function buildHeaders(format: WebFetchFormat, userAgent: string): Record<string, string> {
  return {
    'User-Agent': userAgent,
    Accept: buildAcceptHeader(format),
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function createTimeoutSignal(timeoutMs: number): { controller: AbortController; timerId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  return { controller, timerId };
}

const NON_IMAGE_MIMES = new Set(['image/svg+xml', 'image/vnd.microsoft.icon']);

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && !NON_IMAGE_MIMES.has(mime);
}

function convertHtmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  td.remove(['script', 'style', 'meta', 'link']);
  try {
    return td.turndown(html);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return formatError(`failed to convert HTML to markdown: ${message}`);
  }
}

const SKIP_TAGS = ['script', 'style', 'noscript', 'iframe', 'object', 'embed'] as const;
const SKIP_TAGS_RE = new RegExp(`<(${SKIP_TAGS.join('|')})[\\s\\S]*?<\\/\\1>`, 'gi');

async function extractTextFromHtml(html: string): Promise<string> {
  const Rewriter = (globalThis as { HTMLRewriter?: new () => any }).HTMLRewriter;
  if (typeof Rewriter !== 'function') {
    return html
      .replace(SKIP_TAGS_RE, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+\n/g, '\n')
      .trim();
  }

  let text = '';
  let skip = false;
  const rewriter: any = new Rewriter();
  rewriter
    .on(SKIP_TAGS.join(', '), {
      element() {
        skip = true;
      },
      text() {
        // drop text inside skipped elements
      },
    })
    .on('*', {
      element(el: any) {
        if (!SKIP_TAGS.includes(el.tagName)) skip = false;
      },
      text(t: any) {
        if (!skip) text += t.text;
      },
    });

  const transformed: Response = rewriter.transform(new Response(html));
  await transformed.text();
  return text.trim();
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function pickFormat(value: unknown): WebFetchFormat {
  return value === 'text' || value === 'html' || value === 'markdown' ? value : 'markdown';
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
  format: WebFetchFormat,
  fetchSignal: AbortSignal,
  timeoutMs: number,
): Promise<FetchAttempt> {
  const headers = buildHeaders(format, UA_BROWSER);
  let response: Response;
  try {
    response = await fetch(url, { signal: fetchSignal, headers });
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

  if (response.status === 403 && response.headers.get('cf-mitigated') === 'challenge') {
    // Drain the prior body so undici/Bun release the socket before the retry.
    await response.body?.cancel().catch(() => {});
    try {
      response = await fetch(url, {
        signal: fetchSignal,
        headers: { ...headers, 'User-Agent': UA_RETRY },
      });
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
  }

  return { ok: true, response };
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

function imageDataUrl(url: string, mime: string, buf: ArrayBuffer): string {
  const base64 = Buffer.from(buf).toString('base64');
  return `[image: ${mime}, ${buf.byteLength} bytes from ${url}]\ndata:${mime};base64,${base64}`;
}

async function renderBody(buf: ArrayBuffer, contentType: string, format: WebFetchFormat): Promise<string> {
  const body = new TextDecoder().decode(buf);
  const isHtml = contentType.includes('text/html');
  if (format === 'html') return body;
  if (!isHtml) return body;
  return format === 'markdown' ? convertHtmlToMarkdown(body) : await extractTextFromHtml(body);
}

async function runWebFetch(args: Record<string, unknown>): Promise<string> {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return formatError('url is required');
  if (!isHttpUrl(url)) return formatError('URL must start with http:// or https://');

  const format = pickFormat(args.format);
  const timeoutPick = pickTimeoutMs(args.timeout);
  if (!timeoutPick.ok) return timeoutPick.error;
  const timeoutMs = timeoutPick.ms;
  // TODO: mu-core's Tool.execute signature doesn't pass an AbortSignal yet — when
  // it does, combine the executor signal with this timeout via AbortSignal.any().
  const { controller, timerId } = createTimeoutSignal(timeoutMs);

  try {
    const attempt = await fetchWithCloudflareRetry(url, format, controller.signal, timeoutMs);
    if ('error' in attempt) return attempt.error;
    const { response } = attempt;
    if (!response.ok) {
      // Drain the body so undici/Bun release the socket instead of waiting for GC.
      await response.body?.cancel().catch(() => {});
      return formatError(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const bounded = await readBoundedBuffer(response);
    if ('error' in bounded) return bounded.error;
    const { buf } = bounded;

    const contentType = response.headers.get('content-type') ?? '';
    const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();

    if (isImageMime(mime)) return imageDataUrl(url, mime, buf);
    return await renderBody(buf, contentType, format);
  } finally {
    clearTimeout(timerId);
  }
}

export function createWebFetchTool(): Tool {
  return {
    name: 'webfetch',
    description: 'Fetch a URL and return it as markdown (default), text, or raw HTML.',
    systemPrompt: WEBFETCH_SYSTEM_PROMPT,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Fully-formed http:// or https:// URL.',
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown', 'html'],
          default: 'markdown',
          description: 'Output format.',
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
