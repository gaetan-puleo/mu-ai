import { Box, Text, type DOMElement } from 'ink';
import type { ReactNode } from 'react';
import { useTheme } from '../../theme/ThemeContext';

export interface ModalProps {
  title?: string;
  children: ReactNode;
  width?: number | string;
  footer?: ReactNode;
}

export function Modal({ title, children, width, footer }: ModalProps) {
  const theme = useTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.border}
      paddingX={1}
      paddingY={0}
      width={width ?? 80}
    >
      {title ? (
        <Box marginBottom={1}>
          <Text bold color={theme.colors.heading}>
            {title}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column">{children}</Box>
      {footer ? (
        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export type { DOMElement };
