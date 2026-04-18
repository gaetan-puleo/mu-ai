import { Box, Text } from 'ink';

interface ReadOutputProps {
  args: string;
  error: boolean;
}

export function ReadOutput({ args, error }: ReadOutputProps) {
  let paths: string[] = ['(unknown)'];
  let startLine: number | undefined;
  let endLine: number | undefined;

  try {
    const parsed = JSON.parse(args);
    const p = parsed.path;
    paths = Array.isArray(p) ? p : [p];
    startLine = parsed.start;
    endLine = parsed.end;
  } catch {
    // ignore
  }

  const rangeLabel = startLine != null && endLine != null ? ` (lines ${startLine}-${endLine})` : '';

  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Text dimColor={true} wrap="wrap">
        <Text color={error ? 'red' : 'green'} bold={true}>
          {error ? '✗' : '✓'} read_file
        </Text>{' '}
        {paths.length > 1 ? `(${paths.length} files)` : ''}
        {paths.length > 1 ? '\n' : ''}
        {paths.map((p) => (
          <Text key={p} dimColor={true} wrap="wrap">
            {paths.length > 1 ? '  • ' : ''}
            {p}
          </Text>
        ))}
        {rangeLabel}
      </Text>
    </Box>
  );
}
