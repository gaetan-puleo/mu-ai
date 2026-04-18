import { Box, Text } from 'ink';
import { computeDiff, renderDiff } from '../../../diff';

interface EditOutputProps {
  args: string;
  content: string;
  error: boolean;
}

export function EditOutput({ args, content, error }: EditOutputProps) {
  let path = '(unknown)';
  let oldString = '';
  let newString = '';

  try {
    const parsed = JSON.parse(args);
    path = parsed.path ?? '(unknown)';
    oldString = parsed.old_string ?? '';
    newString = parsed.new_string ?? '';
  } catch {
    // ignore
  }

  if (error) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text color="red" bold={true}>
          ✗ edit_file
        </Text>
        <Text dimColor={true}> {path}</Text>
        <Text dimColor={true} wrap="wrap">
          {content}
        </Text>
      </Box>
    );
  }

  const diff = computeDiff(oldString, newString);

  if (diff.lines.length === 0 && diff.totalOldLines > 0 && diff.totalNewLines > 0) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text color="yellow" bold={true}>
          ! edit_file
        </Text>
        <Text dimColor={true}> {path}</Text>
        <Text dimColor={true}>
          Diff too large to display ({diff.totalOldLines} → {diff.totalNewLines} lines)
        </Text>
      </Box>
    );
  }

  if (diff.lines.length === 0) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text color="green" bold={true}>
          ✓ edit_file
        </Text>
        <Text dimColor={true}> {path}</Text>
        <Text dimColor={true}>No changes (content identical)</Text>
      </Box>
    );
  }

  const { lines, truncated } = renderDiff(diff, 30);

  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text color="green" bold={true}>
        ✓ edit_file
      </Text>
      <Text dimColor={true}> {path}</Text>
      <Box flexDirection="column" flexShrink={0}>
        {lines.map((line) => {
          let color: string | undefined;
          if (line.startsWith('-')) color = 'red';
          else if (line.startsWith('+')) color = 'green';
          return (
            <Text key={line} color={color} dimColor={color === undefined} wrap="wrap">
              {line}
            </Text>
          );
        })}
        {truncated && <Text dimColor={true}>… (truncated, 30 line limit)</Text>}
      </Box>
    </Box>
  );
}
