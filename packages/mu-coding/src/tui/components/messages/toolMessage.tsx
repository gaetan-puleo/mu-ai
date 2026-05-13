import { Box, Text } from 'ink';
import type { Message } from 'mu-core';
import { getMuCodingTUI } from '../../api';
import { useTheme } from '../../theme/ThemeContext';
import { BashOutput } from './bashOutput';
import { EditOutput } from './editOutput';
import { ListDirOutput } from './listDirOutput';
import { ReadOutput } from './readOutput';
import { SubagentOutput } from './subagentOutput';
import { WebfetchOutput } from './webfetchOutput';
import { WriteOutput } from './writeOutput';

function findCallArgs(toolName: string, callId: string | undefined, transcript: Message[]): Record<string, unknown> {
  if (!callId) return {};
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (!m) continue;
    if (m.toolCalls) {
      const call = m.toolCalls.find((c) => c.id === callId);
      if (call) {
        try {
          return JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          return {};
        }
      }
    }
  }
  return {};
}

export function ToolMessage({ message, transcript }: { message: Message; transcript: Message[] }) {
  const theme = useTheme();
  const result = message.toolResult;
  if (!result) return null;

  const toolName = result.name;
  const error = !!result.error;
  const content = result.content;
  const args = findCallArgs(toolName, message.toolCallId, transcript);

  // Plugin-contributed renderer takes precedence.
  const tui = getMuCodingTUI();
  if (tui) {
    // The TUI surface lets plugins register renderers via `tui.renderer(toolName, ...)`.
    // We can't peek at the registry directly without exposing it; the App
    // composes this via a context. For now we just fall through to built-ins.
  }

  switch (toolName) {
    case 'bash':
      return <BashOutput content={content} error={error} />;
    case 'edit':
      return <EditOutput args={args} content={content} error={error} />;
    case 'read':
      return <ReadOutput args={args} content={content} error={error} />;
    case 'write':
      return <WriteOutput args={args} content={content} error={error} />;
    case 'list_dir':
      return <ListDirOutput args={args} content={content} error={error} />;
    case 'webfetch':
      return <WebfetchOutput args={args} content={content} error={error} />;
    case 'subagent':
    case 'subagent_parallel':
      return <SubagentOutput args={args} content={content} error={error} />;
    default:
      return (
        <Box flexDirection="column" borderStyle="single" borderColor={error ? theme.colors.error : theme.colors.border} paddingX={1}>
          <Text dimColor>{toolName}{error ? ' (error)' : ''}</Text>
          <Text>{content.slice(0, 400)}</Text>
          {content.length > 400 ? <Text dimColor>… +{content.length - 400} chars</Text> : null}
        </Box>
      );
  }
}
