import { Box, Text } from 'ink';
import { ToolHeader } from './ToolHeader';

interface ReadOutputProps {
  args: string;
  error: boolean;
}

interface ReadArgs {
  paths: string[];
  startLine?: number;
  endLine?: number;
}

function parseReadArgs(args: string): ReadArgs {
  try {
    const parsed = JSON.parse(args);
    const p = parsed.path;
    return {
      paths: Array.isArray(p) ? p : [p ?? '(unknown)'],
      startLine: typeof parsed.start === 'number' ? parsed.start : undefined,
      endLine: typeof parsed.end === 'number' ? parsed.end : undefined,
    };
  } catch {
    return { paths: ['(unknown)'] };
  }
}

export function ReadOutput({ args, error }: ReadOutputProps) {
  const { paths, startLine, endLine } = parseReadArgs(args);
  const rangeLabel = startLine != null && endLine != null ? ` (lines ${startLine}-${endLine})` : '';
  const subtitle = paths.length === 1 ? `${paths[0]}${rangeLabel}` : `${paths.length} files${rangeLabel}`;

  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <ToolHeader name="read_file" subtitle={subtitle} error={error} />
      {paths.length > 1 && (
        <Box flexDirection="column" flexShrink={0}>
          {paths.map((p) => (
            <Text key={p} dimColor={true} wrap="wrap">
              {`  • ${p}`}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
