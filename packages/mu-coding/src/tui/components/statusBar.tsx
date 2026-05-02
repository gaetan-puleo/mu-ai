import { Box, Text } from 'ink';
import { useTheme } from '../context/ThemeContext';

export interface StatusBarSegment {
  text: string;
  color?: string;
  dim?: boolean;
  /** Pin to the left zone of the status bar. Defaults to right-aligned. */
  align?: 'left' | 'right';
}

function renderZone(segments: StatusBarSegment[], separatorColor: string) {
  return segments.map((seg, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: positional static list
    <Box key={i}>
      {i > 0 && (
        <Text color={separatorColor} dimColor={true}>
          {' '}
          ·{' '}
        </Text>
      )}
      <Text color={seg.color} dimColor={seg.dim}>
        {seg.text}
      </Text>
    </Box>
  ));
}

export function StatusBar({ segments }: { segments: StatusBarSegment[] }) {
  const theme = useTheme();
  const left = segments.filter((s) => s.align === 'left');
  const right = segments.filter((s) => s.align !== 'left');
  return (
    <Box flexShrink={0} paddingX={1} marginTop={1}>
      <Box>{renderZone(left, theme.status.separator)}</Box>
      <Box justifyContent="flex-end" flexGrow={1}>
        {renderZone(right, theme.status.separator)}
      </Box>
    </Box>
  );
}
