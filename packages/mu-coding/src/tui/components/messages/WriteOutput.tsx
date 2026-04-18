import { Box, Text } from 'ink';

const PREVIEW_LINES = 30;

interface WriteOutputProps {
  args: string;
  content: string;
  error: boolean;
  expanded: boolean;
}

export function WriteOutput({ args, content, error, expanded }: WriteOutputProps) {
  let path = '(unknown)';
  try {
    const parsed = JSON.parse(args);
    path = parsed.path ?? '(unknown)';
  } catch {
    // ignore
  }

  if (error) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text color="red" bold={true}>
          ✗ write_file
        </Text>
        <Text dimColor={true} wrap="wrap">
          {content}
        </Text>
      </Box>
    );
  }

  const lines = content.split('\n');
  const totalLines = lines.length;
  const preview = lines.slice(0, PREVIEW_LINES).join('\n');
  const hasMore = totalLines > PREVIEW_LINES;

  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text color="green" bold={true}>
        ✓ write_file
      </Text>
      <Text dimColor={true}> {path}</Text>
      <Box flexDirection="column" flexShrink={0}>
        <Text dimColor={true}>
          {totalLines} line{totalLines !== 1 ? 's' : ''}
        </Text>
        <Box flexDirection="column" flexShrink={0}>
          <Text dimColor={true} wrap="wrap">
            {expanded ? content : preview}
          </Text>
          {hasMore && !expanded && <Text dimColor={true}>… ({totalLines - PREVIEW_LINES} more lines)</Text>}
          {!expanded && (
            <Box>
              <Text color="cyan"> [Enter] show more </Text>
            </Box>
          )}
          {expanded && (
            <Box>
              <Text color="cyan"> [Enter] show less </Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
