import { Box } from 'ink';
import { ToolHeader } from './ToolHeader';

interface WebFetchOutputProps {
  args: string;
  error: boolean;
}

function parseUrl(args: string): string {
  try {
    const parsed = JSON.parse(args);
    return typeof parsed.url === 'string' ? parsed.url : '(unknown)';
  } catch {
    return '(unknown)';
  }
}

/**
 * Compact renderer for the `webfetch` tool — shows a one-line header with the
 * fetched URL and elides the (often huge) response body so it doesn't fill
 * the transcript. Mirrors `ReadOutput`'s minimal layout.
 */
export function WebFetchOutput({ args, error }: WebFetchOutputProps) {
  const url = parseUrl(args);
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={0}>
      <ToolHeader name="webfetch" subtitle={url} error={error} />
    </Box>
  );
}
