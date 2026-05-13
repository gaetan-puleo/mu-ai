import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';
import { Markdown } from '../markdown/render';

export function SubagentOutput({ args, content, error }: { args: { agent?: string; task?: string }; content: string; error: boolean }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={error ? theme.colors.error : theme.colors.agent} paddingX={1}>
      <Text>
        <Text color={theme.colors.agentBadge} bold>
          {args.agent ?? 'subagent'}
        </Text>
        {args.task ? <Text dimColor> — {args.task.slice(0, 80)}</Text> : null}
      </Text>
      <Markdown text={content} />
    </Box>
  );
}
