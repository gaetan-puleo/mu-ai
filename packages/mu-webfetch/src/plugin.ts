/**
 * mu-webfetch — fetches the contents of a URL and returns it formatted as
 * markdown (default), plain text, or raw HTML. Adapted from opencode's
 * `webfetch` tool (sst/opencode @ dev, packages/opencode/src/tool/webfetch.ts).
 *
 * Differences vs. opencode:
 *  - mu's PluginTool has no native attachment channel, so image responses
 *    return a `data:<mime>;base64,...` URL inline as text.
 *  - HTML→text uses Bun's HTMLRewriter when available with a regex fallback
 *    for non-Bun hosts.
 *  - Cloudflare retry uses `User-Agent: mu` (vs. `opencode`).
 */

import type { Plugin, PluginTool, ToolExecutorResult } from 'mu-core';
import TurndownService from 'turndown';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 30_000; // 30 s
const MAX_TIMEOUT_MS = 120_000; // 2 min
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

/** Combine the host abort signal with an internal timeout signal. */
function composeSignal(host: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const timer = new AbortController();
  const timerId = setTimeout(() => timer.abort(new Error('Request timed out')), timeoutMs);
  const cancel = () => clearTimeout(timerId);

  if (!host) return { signal: timer.signal, cancel };

  // AbortSignal.any is available in Bun 1.0+ and Node 20+.
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn([host, timer.signal]), cancel };
  }

  // Manual fallback: forward host abort into the timer controller.
  if (host.aborted) {
    timer.abort(host.reason);
  } else {
    host.addEventListener('abort', () => timer.abort(host.reason), { once: true });
  }
  return { signal: timer.signal, cancel };
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
  return td.turndown(html);
}

const SKIP_TAGS = ['script', 'style', 'noscript', 'iframe', 'object', 'embed'] as const;

async function extractTextFromHtml(html: string): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: Bun's HTMLRewriter has no shipped TS types in this workspace.
  const Rewriter = (globalThis as { HTMLRewriter?: new () => any }).HTMLRewriter;
  if (typeof Rewriter !== 'function') {
    return html
      .replace(/<(script|style|noscript|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+\n/g, '\n')
      .trim();
  }

  let text = '';
  let skip = false;
  // biome-ignore lint/suspicious/noExplicitAny: HTMLRewriter has no TS types.
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
      // biome-ignore lint/suspicious/noExplicitAny: HTMLRewriter event types are not typed.
      element(el: any) {
        if (!SKIP_TAGS.includes(el.tagName)) skip = false;
      },
      // biome-ignore lint/suspicious/noExplicitAny: HTMLRewriter event types are not typed.
      text(t: any) {
        if (!skip) text += t.text;
      },
    });

  const transformed: Response = rewriter.transform(new Response(html));
  await transformed.text();
  return text.trim();
}

function err(content: string): ToolExecutorResult {
  return { content, error: true };
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function pickFormat(value: unknown): WebFetchFormat {
  return value === 'text' || value === 'html' || value === 'markdown' ? value : 'markdown';
}

function pickTimeoutMs(value: unknown): number {
  const seconds = typeof value === 'number' ? value : DEFAULT_TIMEOUT_MS / 1000;
  return Math.min(Math.max(seconds, 0) * 1000, MAX_TIMEOUT_MS);
}

type FetchAttempt = { ok: true; response: Response } | { ok: false; error: ToolExecutorResult };

async function fetchWithCloudflareRetry(
  url: string,
  format: WebFetchFormat,
  fetchSignal: AbortSignal,
  hostSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<FetchAttempt> {
  const headers = buildHeaders(format, UA_BROWSER);
  let response: Response;
  try {
    response = await fetch(url, { signal: fetchSignal, headers });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      if (hostSignal?.aborted) return { ok: false, error: err(`Error fetching ${url}: aborted`) };
      return {
        ok: false,
        error: err(`Error fetching ${url}: request timed out after ${Math.round(timeoutMs)}ms`),
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err(`Error fetching ${url}: ${message}`) };
  }

  if (response.status === 403 && response.headers.get('cf-mitigated') === 'challenge') {
    response = await fetch(url, {
      signal: fetchSignal,
      headers: { ...headers, 'User-Agent': UA_RETRY },
    });
  }

  return { ok: true, response };
}

type BoundedRead = { ok: true; buf: ArrayBuffer } | { ok: false; error: ToolExecutorResult };

async function readBoundedBuffer(response: Response): Promise<BoundedRead> {
  const declaredLen = response.headers.get('content-length');
  if (declaredLen && Number.parseInt(declaredLen, 10) > MAX_RESPONSE_SIZE) {
    return { ok: false, error: err('Error: Response too large (exceeds 5MB limit)') };
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_SIZE) {
    return { ok: false, error: err('Error: Response too large (exceeds 5MB limit)') };
  }
  return { ok: true, buf };
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

async function executeWebFetch(
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string | ToolExecutorResult> {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return err('Error: url is required');
  if (!isHttpUrl(url)) return err('Error: URL must start with http:// or https://');

  const format = pickFormat(args.format);
  const timeoutMs = pickTimeoutMs(args.timeout);
  const { signal: fetchSignal, cancel } = composeSignal(signal, timeoutMs);

  try {
    const attempt = await fetchWithCloudflareRetry(url, format, fetchSignal, signal, timeoutMs);
    if (!attempt.ok) return attempt.error;
    const { response } = attempt;
    if (!response.ok) {
      return err(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const bounded = await readBoundedBuffer(response);
    if (!bounded.ok) return bounded.error;
    const { buf } = bounded;

    const contentType = response.headers.get('content-type') ?? '';
    const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();

    if (isImageMime(mime)) return imageDataUrl(url, mime, buf);
    return await renderBody(buf, contentType, format);
  } finally {
    cancel();
  }
}

function createWebFetchTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'webfetch',
        description: 'Fetch a URL and return it as markdown (default), text, or raw HTML.',
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
      },
    },
    display: {
      verb: 'fetching',
      kind: 'webfetch',
      fields: { path: 'url' },
    },
    permission: {
      // Lets agent definitions glob-allow URLs, e.g.
      //   webfetch: { allow: ["https://github.com/**", "https://*.dev/**"] }
      matchKey: (args) => (typeof args.url === 'string' ? args.url : undefined),
    },
    execute: executeWebFetch,
  };
}

export function createWebFetchPlugin(): Plugin {
  return {
    name: 'mu-webfetch',
    version: '0.9.0',
    tools: [createWebFetchTool()],
    systemPrompt: WEBFETCH_SYSTEM_PROMPT,
  };
}

export default createWebFetchPlugin;
