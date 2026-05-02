import { Box, Text } from 'ink';
import type { MentionCompletion } from 'mu-agents';
import { useTheme } from '../context/ThemeContext';
import type { Theme } from '../theme/types';
import type { SlashCommand } from './commands';

interface MentionPickerView {
  completions: MentionCompletion[];
  selectedIndex: number;
  partial: string;
}

export interface InputBoxViewProps {
  value: string;
  cursor: number;
  commands: SlashCommand[];
  cmdIndex: number;
  isCommandMode: boolean;
  streaming: boolean;
  isActive: boolean;
  model: string;
  attachmentName: string | null;
  attachmentError: string | null;
  mentions: MentionPickerView | null;
}

function CommandHints({
  commands,
  selectedIndex,
  theme,
}: {
  commands: SlashCommand[];
  selectedIndex: number;
  theme: Theme;
}) {
  if (!commands.length) {
    return null;
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {commands.map((cmd, i) => (
        <Box key={cmd.name} paddingX={1}>
          <Text color={i === selectedIndex ? theme.input.commandHighlight : undefined} bold={i === selectedIndex}>
            {i === selectedIndex ? '▸ ' : '  '}
            {cmd.name}
          </Text>
          <Text dimColor={true}> {cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

function MentionHints({ mentions, theme }: { mentions: MentionPickerView; theme: Theme }) {
  if (!mentions.completions.length) {
    return null;
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {mentions.completions.map((c, i) => (
        <Box key={c.value} paddingX={1}>
          <Text
            color={i === mentions.selectedIndex ? theme.input.commandHighlight : undefined}
            bold={i === mentions.selectedIndex}
          >
            {i === mentions.selectedIndex ? '▸ @' : '  @'}
            {c.label ?? c.value}
          </Text>
          {c.description && <Text dimColor={true}> {c.description}</Text>}
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
  hasMentions,
  theme,
}: {
  model: string;
  attachmentName: string | null;
  attachmentError: string | null;
  hasContent: boolean;
  isCommandMode: boolean;
  hasMentions: boolean;
  theme: Theme;
}) {
  const hint = hasMentions
    ? '↑↓ select · Tab/Enter accept'
    : hasContent
      ? isCommandMode
        ? '↑↓ select · Enter execute'
        : 'Enter to send · Shift+Enter for newline · ←→ move'
      : 'Type / for commands · @ for mentions';

  return (
    <Box justifyContent="space-between">
      <Box gap={1}>
        {model && (
          <Text color={theme.input.modelLabel} bold={true}>
            {model}
          </Text>
        )}
        {attachmentName && <Text color={theme.input.attachmentName}>📷 {attachmentName}</Text>}
        {attachmentError && <Text color={theme.input.attachmentError}>{attachmentError}</Text>}
      </Box>
      <Text color={theme.input.footerHint}>{hint}</Text>
    </Box>
  );
}

interface RowProps {
  line: string;
  cursorCol: number | null;
  isCommandLine: boolean;
  theme: Theme;
}

/**
 * Render one buffer row, splicing the cursor glyph at `cursorCol` if the
 * cursor lives on this row. Splitting around the cursor (rather than rendering
 * the whole line and overlaying) keeps the layout flowing inside Ink's text
 * wrapping engine.
 */
function InputRow({ line, cursorCol, isCommandLine, theme }: RowProps) {
  const colorize = (text: string) => (isCommandLine ? <Text color={theme.input.commandHighlight}>{text}</Text> : text);

  if (cursorCol === null) {
    return <Text wrap="wrap">{colorize(line)}</Text>;
  }

  const before = line.slice(0, cursorCol);
  const after = line.slice(cursorCol);
  return (
    <Text wrap="wrap">
      {colorize(before)}
      <Text color={theme.input.cursor} inverse={true}>
        ▎
      </Text>
      {colorize(after)}
    </Text>
  );
}

interface DisplayProps {
  value: string;
  cursor: number;
  isCommandMode: boolean;
  streaming: boolean;
  isActive: boolean;
  theme: Theme;
}

function InputDisplay({ value, cursor, isCommandMode, streaming, isActive, theme }: DisplayProps) {
  const showCursor = !streaming && isActive;
  if (!value.length) {
    return (
      <Text>
        {showCursor && (
          <Text color={theme.input.cursor} inverse={true}>
            ▎
          </Text>
        )}
      </Text>
    );
  }
  const lines = value.split('\n');
  // Locate cursor row/col by walking newline offsets.
  let row = 0;
  let consumed = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = consumed + lines[i].length;
    if (cursor <= lineEnd) {
      row = i;
      break;
    }
    consumed = lineEnd + 1; // +1 for the newline
    row = i + 1;
  }
  const col = cursor - consumed;
  return (
    <>
      {lines.map((line, i) => (
        <InputRow
          // biome-ignore lint/suspicious/noArrayIndexKey: static input display lines
          key={`${i}-${line}`}
          line={line}
          cursorCol={showCursor && i === row ? col : null}
          isCommandLine={i === 0 && isCommandMode}
          theme={theme}
        />
      ))}
    </>
  );
}

export function InputBoxView(props: InputBoxViewProps) {
  const theme = useTheme();
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      backgroundColor={theme.input.background}
      paddingX={1}
      paddingY={1}
      marginX={1}
      marginTop={1}
    >
      {props.isCommandMode && <CommandHints commands={props.commands} selectedIndex={props.cmdIndex} theme={theme} />}
      {props.mentions && <MentionHints mentions={props.mentions} theme={theme} />}
      <Box flexDirection="column" minHeight={2}>
        <InputDisplay
          value={props.value}
          cursor={props.cursor}
          isCommandMode={props.isCommandMode}
          streaming={props.streaming}
          isActive={props.isActive}
          theme={theme}
        />
      </Box>
      <InputFooter
        model={props.model}
        attachmentName={props.attachmentName}
        attachmentError={props.attachmentError}
        hasContent={props.value.length > 0}
        isCommandMode={props.isCommandMode}
        hasMentions={Boolean(props.mentions)}
        theme={theme}
      />
    </Box>
  );
}
