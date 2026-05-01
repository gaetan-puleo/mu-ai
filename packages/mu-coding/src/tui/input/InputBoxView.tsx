import { Box, Text } from 'ink';
import type { SlashCommand } from './commands';

export interface InputBoxViewProps {
  value: string;
  commands: SlashCommand[];
  cmdIndex: number;
  isCommandMode: boolean;
  streaming: boolean;
  isActive: boolean;
  model: string;
  attachmentName: string | null;
  attachmentError: string | null;
}

function CommandHints({ commands, selectedIndex }: { commands: SlashCommand[]; selectedIndex: number }) {
  if (!commands.length) {
    return null;
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {commands.map((cmd, i) => (
        <Box key={cmd.name} paddingX={1}>
          <Text color={i === selectedIndex ? 'green' : undefined} bold={i === selectedIndex}>
            {i === selectedIndex ? '▸ ' : '  '}
            {cmd.name}
          </Text>
          <Text dimColor={true}> {cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

function InputFooter({
  model,
  attachmentName,
  attachmentError,
  hasContent,
  isCommandMode,
}: {
  model: string;
  attachmentName: string | null;
  attachmentError: string | null;
  hasContent: boolean;
  isCommandMode: boolean;
}) {
  const hint = hasContent
    ? isCommandMode
      ? '↑↓ select · Enter execute'
      : 'Enter to send · Shift+Enter for newline'
    : 'Type / for commands';

  return (
    <Box justifyContent="space-between">
      <Box gap={1}>
        {model && (
          <Text color="white" bold={true}>
            {model}
          </Text>
        )}
        {attachmentName && <Text color="cyan">📷 {attachmentName}</Text>}
        {attachmentError && <Text color="red">{attachmentError}</Text>}
      </Box>
      <Text dimColor={true}>{hint}</Text>
    </Box>
  );
}

function InputDisplay({
  value,
  isCommandMode,
  streaming,
  isActive,
}: {
  value: string;
  isCommandMode: boolean;
  streaming: boolean;
  isActive: boolean;
}) {
  const showCursor = !streaming && isActive;
  if (!value.length) {
    return <Text>{showCursor && <Text inverse={true}>▎</Text>}</Text>;
  }
  const lines = value.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static input display lines
        <Text key={`${i}-${line}`} wrap="wrap">
          {i === 0 && isCommandMode ? <Text color="green">{line}</Text> : line}
          {i === lines.length - 1 && showCursor && <Text inverse={true}>▎</Text>}
        </Text>
      ))}
    </>
  );
}

export function InputBoxView(props: InputBoxViewProps) {
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      backgroundColor="#222222"
      paddingX={1}
      paddingY={1}
      marginX={1}
      marginTop={1}
    >
      {props.isCommandMode && <CommandHints commands={props.commands} selectedIndex={props.cmdIndex} />}
      <Box flexDirection="column" minHeight={2}>
        <InputDisplay
          value={props.value}
          isCommandMode={props.isCommandMode}
          streaming={props.streaming}
          isActive={props.isActive}
        />
      </Box>
      <InputFooter
        model={props.model}
        attachmentName={props.attachmentName}
        attachmentError={props.attachmentError}
        hasContent={props.value.length > 0}
        isCommandMode={props.isCommandMode}
      />
    </Box>
  );
}
