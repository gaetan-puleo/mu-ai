import { Box, Text, useInput } from 'ink';
import type { AgentsHandle, MentionCompletion } from 'mu-agents';
import type { Command } from 'mu-core';
import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import type { Theme } from '../../theme/types';
import { sanitizeTerminalInput } from '../../utils/sanitize';
import { filterCommands } from './commandPicker';

/**
 * Pixel-faithful port of the v0.15.0 `InputBoxView` (5c5ae8c) onto the
 * current state-driven plumbing. The render tree mirrors the old one
 * exactly — no `❯` prefix glyph, `<Box flexDirection="column" minHeight={2}>`
 * around the buffer, inline CommandHints / MentionHints stacked above the
 * text, footer with terse `↑↓ · Tab accept` / `↑↓ · Enter run` /
 * `/ commands · @ mentions` hints. Key handling stays simple — paste
 * sanitisation, arrow nav, Shift+Enter newline — since the old behaviour
 * lived in a 1600-line input subsystem we're intentionally not restoring.
 */

export interface InputBoxPicker {
  kind: 'command' | 'mention';
  partial: string;
  index: number;
}

export interface InputBoxProps {
  /** Called on Enter (no shift). */
  onSubmit: (text: string) => void;
  /** Called whenever the value changes. */
  onChange?: (text: string) => void;
  /** Disable focus/typing. */
  disabled?: boolean;
  /** Currently active inline picker (rendered inside the box). */
  picker?: InputBoxPicker;
  /** Commands list — required when `picker.kind === 'command'`. */
  commands?: readonly Command[];
  /** Agents handle — required when `picker.kind === 'mention'`. */
  agents?: AgentsHandle;
  /** Active model id, surfaced in the footer. */
  model?: string;
  /** Show a streaming indicator in place of the cursor. */
  streaming?: boolean;
}

// ─── Inline hint panes ───────────────────────────────────────────────────────

function CommandHints({
  commands,
  selectedIndex,
  theme,
}: {
  commands: readonly Command[];
  selectedIndex: number;
  theme: Theme;
}) {
  if (commands.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {commands.map((cmd, i) => (
        <Box key={cmd.name} paddingX={1}>
          <Text color={i === selectedIndex ? theme.colors.inputAccent : undefined} bold={i === selectedIndex}>
            {i === selectedIndex ? '▸ ' : '  '}
            {cmd.name}
          </Text>
          <Text dimColor> {cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

function renderHighlightedLabel(label: string, partial: string, theme: Theme) {
  if (!partial) return <>{label}</>;
  const idx = label.toLowerCase().indexOf(partial.toLowerCase());
  if (idx < 0) return <>{label}</>;
  const head = label.slice(0, idx);
  const match = label.slice(idx, idx + partial.length);
  const tail = label.slice(idx + partial.length);
  return (
    <>
      {head}
      <Text color={theme.colors.inputAccent} bold>
        {match}
      </Text>
      {tail}
    </>
  );
}

function MentionHints({
  completions,
  selectedIndex,
  partial,
  theme,
}: {
  completions: MentionCompletion[];
  selectedIndex: number;
  partial: string;
  theme: Theme;
}) {
  if (completions.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {completions.map((c, i) => {
        const selected = i === selectedIndex;
        const labelText = c.label ?? c.value;
        return (
          <Box key={c.value} paddingX={1}>
            <Text
              wrap="truncate-start"
              color={selected ? theme.colors.inputAccent : undefined}
              bold={selected}
            >
              {selected ? '▸ @' : '  @'}
              {renderHighlightedLabel(labelText, partial, theme)}
            </Text>
            {c.description ? <Text dimColor> {c.description}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function InputFooter({
  model,
  hasContent,
  isCommandMode,
  hasMentions,
  theme,
}: {
  model?: string;
  hasContent: boolean;
  isCommandMode: boolean;
  hasMentions: boolean;
  theme: Theme;
}) {
  const hint = hasMentions
    ? '↑↓ · Tab accept'
    : hasContent
      ? isCommandMode
        ? '↑↓ · Enter run'
        : ''
      : '/ commands · @ mentions';
  return (
    <Box justifyContent="space-between">
      <Box gap={1}>
        {model ? (
          <Text color={theme.colors.info} bold>
            {model}
          </Text>
        ) : null}
      </Box>
      <Text color={theme.colors.inputFooterHint}>{hint}</Text>
    </Box>
  );
}

// ─── Buffer display ──────────────────────────────────────────────────────────

interface RowProps {
  line: string;
  cursorCol: number | null;
  isCommandLine: boolean;
  theme: Theme;
}

function InputRow({ line, cursorCol, isCommandLine, theme }: RowProps) {
  const colorize = (text: string) =>
    isCommandLine ? <Text color={theme.colors.inputAccent}>{text}</Text> : <>{text}</>;
  if (cursorCol === null) {
    return <Text wrap="wrap">{colorize(line)}</Text>;
  }
  const before = line.slice(0, cursorCol);
  const after = line.slice(cursorCol);
  return (
    <Text wrap="wrap">
      {colorize(before)}
      <Text color={theme.colors.inputCursor} inverse>
        ▎
      </Text>
      {colorize(after)}
    </Text>
  );
}

function InputDisplay({
  value,
  cursor,
  isCommandMode,
  streaming,
  isActive,
  theme,
}: {
  value: string;
  cursor: number;
  isCommandMode: boolean;
  streaming: boolean;
  isActive: boolean;
  theme: Theme;
}) {
  const showCursor = !streaming && isActive;
  if (!value.length) {
    return (
      <Text>
        {showCursor ? (
          <Text color={theme.colors.inputCursor} inverse>
            ▎
          </Text>
        ) : null}
      </Text>
    );
  }
  const lines = value.split('\n');
  // Walk newline offsets to locate cursor row/col.
  let row = 0;
  let consumed = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = consumed + (lines[i] ?? '').length;
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
          // biome-ignore lint/suspicious/noArrayIndexKey: positional render of buffer rows
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

// ─── InputBox ────────────────────────────────────────────────────────────────

export function InputBox({
  onSubmit,
  onChange,
  disabled,
  picker,
  commands,
  agents,
  model,
  streaming,
}: InputBoxProps) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);

  const setText = (next: string, nextCursor: number): void => {
    setValue(next);
    setCursor(nextCursor);
    onChange?.(next);
  };

  useInput(
    (input, key) => {
      if (disabled) return;
      if (key.return && !key.shift) {
        if (value.trim()) {
          onSubmit(value);
          setText('', 0);
        }
        return;
      }
      if (key.return && key.shift) {
        const next = `${value.slice(0, cursor)}\n${value.slice(cursor)}`;
        setText(next, cursor + 1);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          const next = value.slice(0, cursor - 1) + value.slice(cursor);
          setText(next, cursor - 1);
        }
        return;
      }
      if (key.leftArrow) {
        setCursor(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, cursor + 1));
        return;
      }
      if (key.upArrow) {
        const before = value.slice(0, cursor);
        const lastNl = before.lastIndexOf('\n');
        if (lastNl === -1) return;
        const col = before.length - lastNl - 1;
        const prevStart = value.lastIndexOf('\n', lastNl - 1) + 1;
        const prevLineLen = lastNl - prevStart;
        setCursor(prevStart + Math.min(col, prevLineLen));
        return;
      }
      if (key.downArrow) {
        const nextNl = value.indexOf('\n', cursor);
        if (nextNl === -1) return;
        const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
        const col = cursor - lineStart;
        const followingEnd = value.indexOf('\n', nextNl + 1);
        const followingLen = (followingEnd === -1 ? value.length : followingEnd) - (nextNl + 1);
        setCursor(nextNl + 1 + Math.min(col, followingLen));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const clean = sanitizeTerminalInput(input);
        if (clean) {
          const next = value.slice(0, cursor) + clean + value.slice(cursor);
          setText(next, cursor + clean.length);
        }
      }
    },
    { isActive: !disabled },
  );

  const isCommandMode = value.startsWith('/');
  const isActive = !disabled;
  const filteredCommands = picker?.kind === 'command' && commands ? filterCommands(picker.partial, commands) : [];
  const mentionCompletions =
    picker?.kind === 'mention' && agents ? agents.getCompletions(picker.partial) : [];

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      backgroundColor={theme.colors.inputBackground}
      paddingX={1}
      paddingY={1}
      marginX={1}
      marginTop={1}
    >
      {picker?.kind === 'command' && commands ? (
        <CommandHints
          commands={filteredCommands}
          selectedIndex={picker.index}
          theme={theme}
        />
      ) : null}
      {picker?.kind === 'mention' && agents ? (
        <MentionHints
          completions={mentionCompletions}
          selectedIndex={picker.index}
          partial={picker.partial}
          theme={theme}
        />
      ) : null}
      <Box flexDirection="column" minHeight={2}>
        <InputDisplay
          value={value}
          cursor={cursor}
          isCommandMode={isCommandMode}
          streaming={!!streaming}
          isActive={isActive}
          theme={theme}
        />
      </Box>
      <InputFooter
        model={model}
        hasContent={value.length > 0}
        isCommandMode={isCommandMode}
        hasMentions={picker?.kind === 'mention'}
        theme={theme}
      />
    </Box>
  );
}
