import { Box, Text } from 'ink';
import { useUi } from '../state/AppContext';
import { useTheme } from '../theme/ThemeContext';

export function StatusBar() {
  const theme = useTheme();
  const { model, activeAgent, tokens, status } = useUi();
  const pluginSegments = Array.from(status.entries()).flatMap(([, segs]) => segs);
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" gap={2}>
        <Text color={theme.colors.muted}>model</Text>
        {model ? (
          <Text color={theme.colors.info}>{model}</Text>
        ) : (
          <Text color={theme.colors.muted} dimColor>
            (none — /model)
          </Text>
        )}
        {activeAgent ? (
          <>
            <Text color={theme.colors.muted}>·</Text>
            <Text color={theme.colors.agentBadge} bold>
              {activeAgent}
            </Text>
          </>
        ) : null}
        {tokens ? (
          <>
            <Text color={theme.colors.muted}>·</Text>
            <Text color={theme.colors.muted}>
              {tokens.prompt}p / {tokens.completion}c = {tokens.total}t
            </Text>
          </>
        ) : null}
      </Box>
      <Box flexDirection="row" gap={2}>
        {pluginSegments.map((seg, i) => (
          <Text key={i} color={seg.color} bold={seg.bold} dimColor={seg.dim}>
            {seg.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
