import { Box, Text } from 'ink';
import type { ToolCall } from 'mu-core';
import { useTheme } from '../../theme/ThemeContext';

export function ToolCallBlock({ call }: { call: ToolCall }) {
  const theme = useTheme();
  let argsPreview = '';
  try {
    const parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
    argsPreview = Object.entries(parsed)
      .map(([k, v]) => `${k}=${truncate(String(v), 40)}`)
      .join(' ');
  } catch {
    argsPreview = truncate(call.function.arguments, 80);
  }
  return (
    <Box flexDirection="row">
      <Text color={theme.colors.tool}>⚙ {call.function.name}</Text>
      {argsPreview ? <Text dimColor> {argsPreview}</Text> : null}
    </Box>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
