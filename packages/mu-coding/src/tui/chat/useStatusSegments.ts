import type { StatusSegment } from 'mu-agents';
import type { StatusBarSegment } from '../components/statusBar';
import { useSpinner } from '../hooks/useUI';

const ERROR_PREVIEW_LEN = 40;

interface StatusSegmentOptions {
  streaming: boolean;
  abortWarning: boolean;
  quitWarning: boolean;
  error: string | null;
  modelError: string | null;
  tokensPerSecond: number;
  pluginStatus?: StatusSegment[];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function useStatusSegments(options: StatusSegmentOptions): StatusBarSegment[] {
  const spinner = useSpinner(options.streaming);
  const segments: StatusBarSegment[] = [];

  if (options.streaming) {
    segments.push({ text: `${spinner} generating`, color: 'yellow' });
  }
  if (options.tokensPerSecond > 0) {
    segments.push({ text: `${options.tokensPerSecond} tok/s`, dim: true });
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
