import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useDispatch } from '../../state/AppContext';
import { useTheme } from '../../theme/ThemeContext';
import { Modal } from '../primitives/modal';

export interface ConfirmModalProps {
  title: string;
  message?: string;
  resolve: (value: boolean) => void;
}

/**
 * Yes/No confirmation modal. Keyboard:
 *  - ←/→ or h/l   move selection
 *  - y/Y / n/N    direct answer
 *  - Enter        confirm selected
 *  - Esc          treats as "No" via the modal_close path
 */
export function ConfirmModal({ title, message, resolve }: ConfirmModalProps) {
  const theme = useTheme();
  const dispatch = useDispatch();
  const [selected, setSelected] = useState(0);

  const close = (value: boolean): void => {
    resolve(value);
    dispatch({ type: 'modal_close' });
  };

  useInput((input, key) => {
    if (key.escape) {
      close(false);
    } else if (key.return) {
      close(selected === 0);
    } else if (key.leftArrow || input === 'h') {
      setSelected(0);
    } else if (key.rightArrow || input === 'l') {
      setSelected(1);
    } else if (input === 'y' || input === 'Y') {
      close(true);
    } else if (input === 'n' || input === 'N') {
      close(false);
    }
  });

  return (
    <Modal title={title}>
      {message ? (
        <Box marginBottom={1}>
          <Text>{message}</Text>
        </Box>
      ) : null}
      <Box gap={2}>
        <Text color={selected === 0 ? theme.colors.success : undefined} bold={selected === 0}>
          {selected === 0 ? '▸ ' : '  '}Yes
        </Text>
        <Text color={selected === 1 ? theme.colors.error : undefined} bold={selected === 1}>
          {selected === 1 ? '▸ ' : '  '}No
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.colors.dialogHint}>y/n · Enter to confirm · Esc to cancel</Text>
      </Box>
    </Modal>
  );
}
