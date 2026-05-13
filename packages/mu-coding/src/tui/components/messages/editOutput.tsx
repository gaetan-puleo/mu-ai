import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';
import { computeDiff, renderDiff } from '../../utils/diff';
import { ToolHeader } from './toolHeader';

export interface EditOutputProps {
  args: { path?: string; from?: string; to?: string };
  content: string;
  error: boolean;
}

const MAX_DIFF_LINES = 30;

/**
 * Rich Edit-tool result renderer. Restored from `5c5ae8c:.../EditOutput.tsx`
 * (112 LOC) — the previous revision had thinned it to a basic LCS list
 * which lost: previewBackground framing, the "too large to display"
 * fast-path, the truncation footer, and the shared ToolHeader.
 */
export function EditOutput({ args, content, error }: EditOutputProps) {
  const theme = useTheme();
  const verb = 'edit_file';
  const path = args.path ?? '(unknown)';
  const before = args.from ?? '';
  const after = args.to ?? '';

  if (error) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <ToolHeader name={verb} subtitle={path} error />
        <Text dimColor wrap="wrap">
          {content}
        </Text>
      </Box>
    );
  }

  const diff = computeDiff(before, after);

  // Diff suppressed by the 500-line ceiling — surface the dimensions so
  // the user knows why no hunks are visible.
  if (diff.lines.length === 0 && diff.totalOldLines > 0 && diff.totalNewLines > 0) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Text color={theme.colors.warning} bold>
          ! {verb}
        </Text>
        <Text dimColor> {path}</Text>
        <Text dimColor>
          Diff too large to display ({diff.totalOldLines} → {diff.totalNewLines} lines)
        </Text>
      </Box>
    );
  }

  if (diff.lines.length === 0) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <ToolHeader name={verb} subtitle={path} />
        <Text dimColor>No changes (content identical)</Text>
      </Box>
    );
  }

  const { lines, truncated } = renderDiff(diff, MAX_DIFF_LINES);

  return (
    <Box flexDirection="column" flexShrink={0}>
      <ToolHeader name={verb} subtitle={path} />
      <Box
        flexDirection="column"
        flexShrink={0}
        backgroundColor={theme.colors.previewBackground}
        paddingX={1}
        paddingY={0}
      >
        {lines.map((line, i) => {
          let color: string | undefined;
          if (line.startsWith('-')) color = theme.colors.diffRemove;
          else if (line.startsWith('+')) color = theme.colors.diffAdd;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines may repeat (blank lines, braces); index disambiguates
            <Text key={`${i}-${line}`} color={color} dimColor={color === undefined} wrap="wrap">
              {line}
            </Text>
          );
        })}
        {truncated ? <Text dimColor>… (truncated, {MAX_DIFF_LINES} line limit)</Text> : null}
      </Box>
    </Box>
  );
}
