import { Box, Text } from 'ink';
import React from 'react';

export interface StatusBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function StatusBar({ left, right }: StatusBarProps): React.ReactElement {
  return (
    <Box flexShrink={0} justifyContent="space-between">
      <Text dimColor>{left}</Text>
      <Text dimColor>{right}</Text>
    </Box>
  );
}
