import { Box, Text } from 'ink';
import type React from 'react';

export interface StatusBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function StatusBar({ left, right }: StatusBarProps): React.ReactElement {
  // Render each side inside a Box so an absent `left` still occupies a real
  // flex child. Without this, `<Text>{null}</Text>` collapses to zero items
  // and `justify-content: space-between` slides the lone right side back
  // to the start of the row.
  return (
    <Box flexShrink={0} width="100%" justifyContent="space-between">
      <Box flexShrink={0}>
        <Text dimColor={true}>{left ?? ' '}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor={true}>{right}</Text>
      </Box>
    </Box>
  );
}
