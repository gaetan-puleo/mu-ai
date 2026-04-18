import { Box, Text } from 'ink';
import type { SlashCommand } from '../commands';
import { useChatContext } from '../context/chat';
import { type InputActions, useInputHandler } from '../hooks/useInputHandler';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  isActive?: boolean;
  model?: string;
  history?: string[];
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

export function InputBox({
  onSubmit,
  onScrollUp,
  onScrollDown,
  isActive = true,
  model = '',
  history = [],
}: InputBoxProps) {
  const { session, toggles, attachment, models, abort } = useChatContext();

  const actions: InputActions = {
    onCtrlC: abort.onCtrlC,
    onEsc: abort.onEsc,
    onPaste: attachment.onPaste,
    onNew: session.onNew,
    onCycleModel: models.cycleModel,
    onTogglePicker: toggles.onTogglePicker,
    onToggleSessionPicker: toggles.onToggleSessionPicker,
    onScrollUp,
    onScrollDown,
    modelCount: models.models.length,
  };

  const { value, commands, cmdIndex, isCommandMode } = useInputHandler({
    isActive,
    streaming: session.streaming,
    history,
    actions,
    onSubmit,
  });

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
      {isCommandMode && <CommandHints commands={commands} selectedIndex={cmdIndex} />}
      <Box flexDirection="column" minHeight={2}>
        <InputDisplay value={value} isCommandMode={isCommandMode} streaming={session.streaming} isActive={isActive} />
      </Box>
      <InputFooter
        model={model}
        attachmentName={attachment.attachment?.name ?? null}
        attachmentError={attachment.attachmentError}
        hasContent={value.length > 0}
        isCommandMode={isCommandMode}
      />
    </Box>
  );
}
