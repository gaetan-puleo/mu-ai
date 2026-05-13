import { Box, Text, useInput } from 'ink';
import type { AgentsHandle } from 'mu-agents';
import type { Command } from 'mu-core';
import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { sanitizeTerminalInput } from '../../utils/sanitize';
import { filterCommands } from './commandPicker';

/**
 * Visual restore of the old `InputBox` look (5c5ae8c) re-applied to the
 * current architecture. Differences from the previous (post-rewrite)
 * version:
 *  - Background-filled container with paddingY=1 + margins instead of a
 *    border-only frame.
 *  - First-line command-mode coloring (text typed after `/` shows in the
 *    accent colour to mirror the old "you are entering a command" cue).
 *  - Inline `CommandHints` / `MentionHints` rendered ABOVE the text
 *    inside the same box — the floating PickerModal that App.tsx used
 *    to render alongside is replaced by these inline panes.
 *  - Footer row with the active model name, attachment indicator, and a
 *    dynamic right-aligned hint (`/ commands · @ mentions`,
 *    `↑↓ Tab accept`, `↑↓ Enter run`).
 *
 * Key/cursor handling is unchanged — the minimal-but-correct logic from
 * the previous revision worked, so we keep it.
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
  placeholder?: string;
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

function CommandHints({
  partial,
  selectedIndex,
  commands,
  theme,
}: {
  partial: string;
  selectedIndex: number;
  commands: readonly Command[];
  theme: ReturnType<typeof useTheme>;
}) {
  const matches = filterCommands(partial, commands);
  if (matches.length === 0) {
    return (
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor italic>
          (no matching commands)
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {matches.slice(0, 8).map((cmd, i) => (
        <Box key={cmd.name} paddingX={1}>
          <Text color={i === selectedIndex ? theme.colors.inputAccent : undefined} bold={i === selectedIndex} wrap="truncate-end">
            {i === selectedIndex ? '▸ ' : '  '}
            /{cmd.name}
            <Text dimColor> — {cmd.description}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function renderHighlightedLabel(label: string, partial: string, theme: ReturnType<typeof useTheme>) {
  if (!partial) return label;
  const idx = label.toLowerCase().indexOf(partial.toLowerCase());
  if (idx < 0) return label;
  return (
    <>
      {label.slice(0, idx)}
      <Text color={theme.colors.inputAccent} bold>
        {label.slice(idx, idx + partial.length)}
      </Text>
      {label.slice(idx + partial.length)}
    </>
  );
}

function MentionHints({
  partial,
  selectedIndex,
  agents,
  theme,
}: {
  partial: string;
  selectedIndex: number;
  agents: AgentsHandle;
  theme: ReturnType<typeof useTheme>;
}) {
  const completions = agents.getCompletions(partial);
  if (completions.length === 0) {
    return (
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor italic>
          (no matching agents)
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {completions.slice(0, 8).map((c, i) => (
        <Box key={c.value} paddingX={1}>
          <Text color={i === selectedIndex ? theme.colors.inputAccent : undefined} bold={i === selectedIndex} wrap="truncate-end">
            {i === selectedIndex ? '▸ @' : '  @'}
            {renderHighlightedLabel(c.value, partial, theme)}
            {c.description ? <Text dimColor> {c.description}</Text> : null}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function Footer({
  model,
  hasContent,
  pickerKind,
  theme,
}: {
  model?: string;
  hasContent: boolean;
  pickerKind: 'command' | 'mention' | undefined;
  theme: ReturnType<typeof useTheme>;
}) {
  const hint = pickerKind === 'mention'
    ? '↑↓ navigate · Enter accept · Esc cancel'
    : pickerKind === 'command'
      ? '↑↓ navigate · Enter run · Esc cancel'
      : hasContent
        ? 'Enter submit · Shift+Enter newline'
        : '/ commands · @ mentions';
  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Box gap={1}>
        {model ? (
          <Text color={theme.colors.info} bold>
            {model}
          </Text>
        ) : (
          <Text color={theme.colors.muted} dimColor>
            no model
          </Text>
        )}
      </Box>
      <Text color={theme.colors.inputFooterHint}>{hint}</Text>
    </Box>
  );
}

function renderWithCursor(value: string, cursor: number, accent: string, isCommandMode: boolean, cursorColor: string) {
  if (value.length === 0) {
    return (
      <Text inverse color={cursorColor}>
        ▎
      </Text>
    );
  }
  const lines = value.split('\n');
  // Find cursor row/col by walking the buffer.
  let row = 0;
  let consumed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const end = consumed + line.length;
    if (cursor <= end) {
      row = i;
      break;
    }
    consumed = end + 1;
    row = i + 1;
  }
  const col = cursor - consumed;
  return (
    <>
      {lines.map((line, i) => {
        const accentLine = i === 0 && isCommandMode;
        const cursorOnThis = i === row;
        if (!cursorOnThis) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional render of buffer rows
            <Text key={i} wrap="wrap" color={accentLine ? accent : undefined}>
              {line || ' '}
            </Text>
          );
        }
        const before = line.slice(0, col);
        const after = line.slice(col);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional render of buffer rows
          <Text key={i} wrap="wrap" color={accentLine ? accent : undefined}>
            {before}
            <Text inverse color={cursorColor}>
              ▎
            </Text>
            {after}
          </Text>
        );
      })}
    </>
  );
}

export function InputBox({
  onSubmit,
  onChange,
  disabled,
  placeholder,
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
        // Strip terminal mouse / control bytes; keep \n (for paste) by
        // letting sanitizeTerminalInput preserve it.
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
  const showPlaceholder = value.length === 0 && !!placeholder && !streaming;

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
          partial={picker.partial}
          selectedIndex={picker.index}
          commands={commands}
          theme={theme}
        />
      ) : null}
      {picker?.kind === 'mention' && agents ? (
        <MentionHints
          partial={picker.partial}
          selectedIndex={picker.index}
          agents={agents}
          theme={theme}
        />
      ) : null}
      <Box flexDirection="row" minHeight={1}>
        <Text color={theme.colors.user}>❯ </Text>
        <Box flexDirection="column" flexGrow={1}>
          {showPlaceholder ? (
            <Text dimColor>{placeholder}</Text>
          ) : streaming ? (
            <Text color={theme.colors.muted} dimColor>
              (streaming…)
            </Text>
          ) : (
            renderWithCursor(
              value,
              cursor,
              theme.colors.inputAccent,
              isCommandMode,
              theme.colors.inputCursor,
            )
          )}
        </Box>
      </Box>
      <Footer
        model={model}
        hasContent={value.length > 0}
        pickerKind={picker?.kind}
        theme={theme}
      />
    </Box>
  );
}
