import { Box, Text, useStdout } from 'ink';
import type { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';

interface ModalProps {
  visible: boolean;
  title?: string;
  width?: number;
  children: ReactNode;
}

export function Modal({ visible, title, width: requestedWidth, children }: ModalProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = stdout.columns;
  const rows = stdout.rows;

  if (!visible) {
    return null;
  }

  const modalWidth = requestedWidth ?? Math.min(60, columns - 4);

  return (
    <Box
      position="absolute"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      width={columns}
      height={rows}
      top={0}
      left={0}
    >
      <Box flexDirection="column" width={modalWidth} backgroundColor={theme.modal.background} paddingX={2} paddingY={1}>
        {title && (
          <Box marginBottom={1}>
            <Text bold={true}>{title}</Text>
            <Box flexGrow={1} />
            <Text color={theme.modal.hint}>Esc to close</Text>
          </Box>
        )}
        {children}
      </Box>
    </Box>
  );
}
