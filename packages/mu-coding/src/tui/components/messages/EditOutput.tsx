import { Box, Text } from 'ink';
import type { ToolDisplayHint } from 'mu-core';
import { computeDiff, renderDiff } from '../../../utils/diff';
import { useTheme } from '../../context/ThemeContext';
import { ToolHeader } from './ToolHeader';

interface EditOutputProps {
  args: string;
  content: string;
  error: boolean;
  /**
   * Display hint from the tool's plugin. Used to resolve which JSON arg field
   * holds the path / from-string / to-string, so a plugin can register a
   * diff-kind tool with arbitrary field names.
   */
  hint?: ToolDisplayHint;
}

interface ParsedEditArgs {
  path: string;
  before: string;
  after: string;
}

const MAX_DIFF_LINES = 30;

function parseEditArgs(args: string, hint: ToolDisplayHint | undefined): ParsedEditArgs {
  const fields = hint?.fields ?? {};
  const pathField = fields.path ?? 'path';
  const fromField = fields.from ?? 'old_string';
  const toField = fields.to ?? 'new_string';
  try {
    const parsed = JSON.parse(args);
    return {
      path: parsed[pathField] ?? '(unknown)',
      before: parsed[fromField] ?? '',
      after: parsed[toField] ?? '',
    };
  } catch {
    return { path: '(unknown)', before: '', after: '' };
  }
}

export function EditOutput({ args, content, error, hint }: EditOutputProps) {
  const theme = useTheme();
  const { path, before, after } = parseEditArgs(args, hint);
  const verb = hint?.verb ?? 'edit_file';

  if (error) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <ToolHeader name={verb} subtitle={path} error={true} />
        <Text dimColor={true} wrap="wrap">
          {content}
        </Text>
      </Box>
    );
  }

  const diff = computeDiff(before, after);

  if (diff.lines.length === 0 && diff.totalOldLines > 0 && diff.totalNewLines > 0) {
    return (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text color={theme.diff.warning} bold={true}>
          ! {verb}
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
        <ToolHeader name={verb} subtitle={path} />
        <Text dimColor={true}>No changes (content identical)</Text>
      </Box>
    );
  }

  const { lines, truncated } = renderDiff(diff, MAX_DIFF_LINES);

  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <ToolHeader name={verb} subtitle={path} />
      <Box flexDirection="column" flexShrink={0}>
        {lines.map((line, i) => {
          let color: string | undefined;
          if (line.startsWith('-')) color = theme.diff.removed;
          else if (line.startsWith('+')) color = theme.diff.added;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines may repeat (blank lines, braces); index disambiguates
            <Text key={`${i}-${line}`} color={color} dimColor={color === undefined} wrap="wrap">
              {line}
            </Text>
          );
        })}
        {truncated && <Text dimColor={true}>… (truncated, {MAX_DIFF_LINES} line limit)</Text>}
      </Box>
    </Box>
  );
}
