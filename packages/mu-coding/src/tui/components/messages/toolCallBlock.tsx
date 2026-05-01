import { Box, Text } from 'ink';
import type { ToolDisplayHint } from 'mu-agents';
import type { ChatMessage } from 'mu-provider';
import { useToolDisplay } from '../../chat/ToolDisplayContext';
import { useSpinner } from '../../hooks/useUI';
import { EditOutput } from './EditOutput';
import { ReadOutput } from './ReadOutput';
import { WriteOutput } from './WriteOutput';

/**
 * Render a tool call. Display behaviour is driven by the optional
 * `ToolDisplayHint` the plugin attached to its tool — `kind` selects the
 * dedicated renderer (file-read / file-write / diff / shell), and `verb`
 * shows in the spinner line. Tools without a hint fall back to a generic
 * preview block, so plugin-registered tools "just work" without UI changes.
 */

function getArgSummary(args: string, hint: ToolDisplayHint | undefined): string {
  if (!hint?.fields) return args;
  // For shell-like tools the most useful preview is the command itself;
  // generic tools show the raw JSON.
  const commandField = hint.fields.command;
  if (!commandField) return args;
  try {
    const parsed = JSON.parse(args);
    return parsed[commandField] ?? args;
  } catch {
    return args;
  }
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
  const hint = useToolDisplay(name);

  const result = toolMsg?.toolResult;
  const hasResult = result !== undefined;
  const spinner = useSpinner(!hasResult);
  const verb = hint?.verb ?? 'executing';
  const argSummary = getArgSummary(args, hint);

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
        renderToolOutput(name, args, result.content, result.error ?? false, result.expanded, hint)
      )}
    </Box>
  );
}

function renderToolOutput(
  name: string,
  args: string,
  content: string,
  error: boolean,
  expanded: boolean | undefined,
  hint: ToolDisplayHint | undefined,
) {
  switch (hint?.kind) {
    case 'file-read':
      return <ReadOutput args={args} error={error} />;
    case 'file-write':
      return <WriteOutput args={args} content={content} error={error} expanded={expanded ?? false} />;
    case 'diff':
      return <EditOutput args={args} content={content} error={error} hint={hint} />;
    default:
      return <GenericToolOutput name={name} args={args} content={content} error={error} hint={hint} />;
  }
}

interface GenericProps {
  name: string;
  args: string;
  content: string;
  error: boolean;
  hint: ToolDisplayHint | undefined;
}

function GenericToolOutput({ name, args, content, error, hint }: GenericProps) {
  let summary = '';
  const commandField = hint?.fields?.command;
  if (commandField) {
    try {
      const parsed = JSON.parse(args);
      summary = parsed[commandField] ?? '';
    } catch {
      // ignore
    }
  }

  const preview = content.length > 200 ? `${content.slice(0, 200)}…` : content;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={error ? 'red' : 'green'} bold={true}>
        {error ? '✗' : '✓'} {name}
        {summary && (
          <>
            {' '}
            <Text dimColor={true}>{summary}</Text>
          </>
        )}
      </Text>
      <Box flexDirection="column" backgroundColor="#111111" padding={1} marginTop={1}>
        <Text color="white">{preview}</Text>
      </Box>
    </Box>
  );
}
