import { Box, Text } from 'ink';
import { useTheme } from '../context/ThemeContext';

export interface StatusBarSegment {
  text: string;
  color?: string;
  dim?: boolean;
}

export function StatusBar({ segments }: { segments: StatusBarSegment[] }) {
  const theme = useTheme();
  return (
    <Box flexShrink={0} paddingX={1} marginY={1}>
      <Box justifyContent="flex-end" flexGrow={1}>
        {segments.map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional static list
          <Box key={i}>
            {i > 0 && (
              <Text color={theme.status.separator} dimColor={true}>
                {' '}
                ·{' '}
              </Text>
            )}
            <Text color={seg.color} dimColor={seg.dim}>
              {seg.text}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
