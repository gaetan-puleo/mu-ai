import { Box, Text } from 'ink';

export interface StatusBarSegment {
  text: string;
  color?: string;
  dim?: boolean;
}

export function StatusBar({ segments }: { segments: StatusBarSegment[] }) {
  return (
    <Box flexShrink={0} paddingX={1} marginY={1}>
      <Box justifyContent="flex-end" flexGrow={1}>
        {segments.map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional static list
          <Box key={i}>
            {i > 0 && <Text dimColor={true}> · </Text>}
            <Text color={seg.color} dimColor={seg.dim}>
              {seg.text}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
