import { Box, Text } from 'ink';
import { ToolHeader } from './ToolHeader';

const PREVIEW_LINES = 30;

interface WriteOutputProps {
  args: string;
  content: string;
  error: boolean;
}

function parsePath(args: string): string {
  try {
    const parsed = JSON.parse(args);
    return parsed.path ?? '(unknown)';
  } catch {
    return '(unknown)';
  }
}

export function WriteOutput({ args, content, error }: WriteOutputProps) {
  const path = parsePath(args);

  if (error) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <ToolHeader name="write_file" error={true} />
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
      <ToolHeader name="write_file" subtitle={path} />
      <Box flexDirection="column" flexShrink={0}>
        <Text dimColor={true}>
          {totalLines} line{totalLines !== 1 ? 's' : ''}
        </Text>
        <Box flexDirection="column" flexShrink={0}>
          <Text dimColor={true} wrap="wrap">
            {hasMore ? preview : content}
          </Text>
          {hasMore && <Text dimColor={true}>… ({totalLines - PREVIEW_LINES} more lines)</Text>}
        </Box>
      </Box>
    </Box>
  );
}
