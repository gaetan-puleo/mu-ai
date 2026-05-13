import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext';

export interface StatusBarSegment {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  /** Pin to the left zone of the status bar. Defaults to right-aligned. */
  align?: 'left' | 'right';
}

function renderZone(segments: StatusBarSegment[], separatorColor: string) {
  return segments.map((seg, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: positional static list
    <Box key={i}>
      {i > 0 ? (
        <Text color={separatorColor} dimColor>
          {' '}
          ·{' '}
        </Text>
      ) : null}
      <Text color={seg.color} dimColor={seg.dim} bold={seg.bold}>
        {seg.text}
      </Text>
    </Box>
  ));
}

/**
 * Status bar with left/right zones. Restored from `5c5ae8c:.../statusBar.tsx`
 * — the previous revision hard-coded model/agent/tokens directly from
 * `useUi()` which gave callers no way to compose their own segments
 * (e.g. the subagent browser panel needs its own segment list).
 *
 * Callers build the segment array themselves. For the default chat
 * statusbar, use `useChatStatusSegments()` from `tui/hooks/useStatusSegments.ts`.
 */
export function StatusBar({ segments }: { segments: StatusBarSegment[] }) {
  const theme = useTheme();
  const left = segments.filter((s) => s.align === 'left');
  const right = segments.filter((s) => s.align !== 'left');
  return (
    <Box flexShrink={0} paddingX={1} marginTop={1}>
      <Box>{renderZone(left, theme.colors.statusSeparator)}</Box>
      <Box justifyContent="flex-end" flexGrow={1}>
        {renderZone(right, theme.colors.statusSeparator)}
      </Box>
    </Box>
  );
}
