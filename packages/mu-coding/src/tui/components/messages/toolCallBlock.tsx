import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-provider';
import { useSpinner } from '../../hooks/useUI';
import { EditOutput } from './EditOutput';
import { ReadOutput } from './ReadOutput';
import { WriteOutput } from './WriteOutput';

const TOOL_VERBS: Record<string, string> = {
  bash: 'running',
  read_file: 'reading',
  write_file: 'writing',
  edit_file: 'editing',
};

function getToolArgSummary(name: string, args: string): string {
  if (name === 'bash') {
    try {
      const parsed = JSON.parse(args);
      return parsed.command ?? args;
    } catch {
      return args;
    }
  }
  return args;
}

export function ToolCallBlock({
  toolCall,
  toolMsg,
}: {
  toolCall: { id: string; function: { name: string; arguments: string } };
  toolMsg?: ChatMessage;
}) {
  const name = toolCall.function.name;
  const args = toolCall.function.arguments;

  // Find the matching tool result message
  const result = toolMsg?.toolResult;
  const hasResult = result !== undefined;
  const spinner = useSpinner(!hasResult);
  const verb = TOOL_VERBS[name] ?? 'executing';
  const argSummary = getToolArgSummary(name, args);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {!hasResult ? (
        <Box>
          <Text dimColor={true}>
            {' '}
            {spinner} {verb}... <Text dimColor={true}>{argSummary}</Text>
          </Text>
        </Box>
      ) : (
        renderToolOutput(name, args, result.content, result.error ?? false, result.expanded)
      )}
    </Box>
  );
}

function renderToolOutput(name: string, args: string, content: string, error: boolean, expanded?: boolean) {
  if (name === 'read_file') {
    return <ReadOutput args={args} error={error} />;
  }
  if (name === 'write_file') {
    return <WriteOutput args={args} content={content} error={error} expanded={expanded ?? false} />;
  }
  if (name === 'edit_file') {
    return <EditOutput args={args} content={content} error={error} />;
  }

  // Fallback for bash and unknown tools
  let command = '';
  if (name === 'bash') {
    try {
      const parsed = JSON.parse(args);
      command = parsed.command ?? '';
    } catch {
      // ignore
    }
  }

  const preview = content.length > 200 ? `${content.slice(0, 200)}…` : content;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={error ? 'red' : 'green'} bold={true}>
        {error ? '✗' : '✓'} {name}
        {command && (
          <>
            {' '}
            <Text dimColor={true}>{command}</Text>
          </>
        )}
      </Text>
      <Box flexDirection="column" backgroundColor="#111111" padding={1} marginTop={1}>
        <Text color="white">{preview}</Text>
      </Box>
    </Box>
  );
}
