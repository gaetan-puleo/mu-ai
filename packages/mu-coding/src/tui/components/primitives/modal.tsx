import { Box, Text, useStdout } from 'ink';
import type { ReactNode } from 'react';

interface ModalProps {
  visible: boolean;
  title?: string;
  width?: number;
  children: ReactNode;
}

export function Modal({ visible, title, width: requestedWidth, children }: ModalProps) {
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
      <Box flexDirection="column" width={modalWidth} backgroundColor="#1a1a1a" paddingX={2} paddingY={1}>
        {title && (
          <Box marginBottom={1}>
            <Text bold={true}>{title}</Text>
            <Box flexGrow={1} />
            <Text dimColor={true}>Esc to close</Text>
          </Box>
        )}
        {children}
      </Box>
    </Box>
  );
}
