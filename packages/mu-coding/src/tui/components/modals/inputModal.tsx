import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useDispatch } from '../../state/AppContext';
import { useTheme } from '../../theme/ThemeContext';
import { sanitizeTerminalInput } from '../../utils/sanitize';
import { Modal } from '../primitives/modal';

export interface InputModalProps {
  title: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

/** Single-line text input dialog. Adapted from the old DialogLayer InputDialog. */
export function InputModal({ title, placeholder, resolve }: InputModalProps) {
  const theme = useTheme();
  const dispatch = useDispatch();
  const [value, setValue] = useState('');

  const close = (out: string | null): void => {
    resolve(out);
    dispatch({ type: 'modal_close' });
  };

  useInput((input, key) => {
    if (key.escape) {
      close(null);
      return;
    }
    if (key.return) {
      close(value || null);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // Strip mouse sequences + control bytes; single-line, so drop \t/\n.
    const clean = sanitizeTerminalInput(input).replace(/[\t\n]/g, '');
    if (clean) setValue((v) => v + clean);
  });

  return (
    <Modal title={title}>
      <Box flexDirection="column">
        <Box paddingX={1} marginBottom={1}>
          {!value && placeholder ? (
            <Text color={theme.colors.dropdownPlaceholder}>{placeholder}</Text>
          ) : (
            <Text>{value}</Text>
          )}
          <Text color={theme.colors.cursor} inverse>
            ▎
          </Text>
        </Box>
        <Box>
          <Text color={theme.colors.dialogHint}>Enter to submit · Esc to cancel</Text>
        </Box>
      </Box>
    </Modal>
  );
}
