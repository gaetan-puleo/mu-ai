import type { StatusSegment } from 'mu-core';
import type { StatusBarSegment } from '../components/statusBar';
import { useSpinner } from '../hooks/useUI';

const ERROR_PREVIEW_LEN = 40;

interface StatusSegmentOptions {
  streaming: boolean;
  abortWarning: boolean;
  quitWarning: boolean;
  error: string | null;
  modelError: string | null;
  totalTokens: number;
  /** Tokens served from server-side prompt cache. Rendered as `(N cached)`
   *  next to the total when > 0. Omit (or pass 0) to hide the suffix. */
  cachedTokens?: number;
  /** Model context window (input + output) reported by the provider; when
   *  set, the tokens segment is rendered as `used/limit tokens`. */
  contextLimit?: number;
  pluginStatus?: StatusSegment[];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const tokenFormatter = new Intl.NumberFormat('en-US');
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return tokenFormatter.format(n);
}

export function useStatusSegments(options: StatusSegmentOptions): StatusBarSegment[] {
  const spinner = useSpinner(options.streaming);
  const segments: StatusBarSegment[] = [];

  if (options.streaming) {
    segments.push({ text: spinner, color: 'yellow', align: 'left' });
  }
  if (options.totalTokens > 0) {
    const cached = options.cachedTokens ?? 0;
    const used = formatTokens(options.totalTokens);
    let head: string;
    if (options.contextLimit) {
      const pct = (options.totalTokens / options.contextLimit) * 100;
      const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
      head = `${used} (${pctStr}%)`;
    } else {
      head = used;
    }
    if (cached > 0) {
      segments.push({ text: `${head} · ${formatTokens(cached)} cached`, dim: true });
    } else {
      segments.push({ text: head, dim: true });
    }
  }
  if (options.abortWarning) {
    segments.push({ text: 'Esc again to stop', color: 'yellow' });
  } else if (options.quitWarning) {
    segments.push({ text: 'Ctrl+C again to quit', color: 'yellow' });
  } else if (options.streaming) {
    segments.push({ text: 'Esc to stop', dim: true });
  }
  if (options.error) {
    segments.push({ text: `⚠ ${truncate(options.error, ERROR_PREVIEW_LEN)}`, color: 'red' });
  }
  if (options.modelError) {
    segments.push({ text: `⚠ ${truncate(options.modelError, ERROR_PREVIEW_LEN)}`, color: 'red' });
  }
  if (options.pluginStatus) {
    segments.push(...options.pluginStatus);
  }

  return segments;
}
