import { Box, Text } from 'ink';
import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';

const SUMMARY_CHARS = 120;

export function ReasoningBlock({ text }: { text: string }) {
  const theme = useTheme();
  const [expanded] = useState(false);
  if (!text) return null;
  const shown = expanded ? text : text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}…` : text;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.muted} paddingX={1}>
      <Text dimColor>reasoning</Text>
      <Text dimColor>{shown}</Text>
    </Box>
  );
}
