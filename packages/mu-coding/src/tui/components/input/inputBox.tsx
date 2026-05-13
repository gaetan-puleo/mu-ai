import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';

export interface InputBoxProps {
  /** Called on Enter (no shift). */
  onSubmit: (text: string) => void;
  /** Called whenever the value changes. */
  onChange?: (text: string) => void;
  /** Disable focus/typing. */
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Multi-line input with cursor. Shift-Enter inserts a newline; Enter submits.
 */
export function InputBox({ onSubmit, onChange, disabled, placeholder }: InputBoxProps) {
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
        const next = value.slice(0, cursor) + '\n' + value.slice(cursor);
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
        // Move cursor up one visual line. Find the previous newline boundary.
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
      // Filter control sequences except newline.
      if (input && !key.ctrl && !key.meta) {
        const next = value.slice(0, cursor) + input + value.slice(cursor);
        setText(next, cursor + input.length);
      }
    },
    { isActive: !disabled },
  );

  const display = value.length === 0 && placeholder ? <Text dimColor>{placeholder}</Text> : renderWithCursor(value, cursor);
  return (
    <Box borderStyle="round" borderColor={theme.colors.border} paddingX={1}>
      <Text color={theme.colors.user}>❯ </Text>
      <Box flexDirection="column" flexGrow={1}>
        {display}
      </Box>
    </Box>
  );
}

function renderWithCursor(value: string, cursor: number) {
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || ' ';
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}
