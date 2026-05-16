import { Box, Text } from 'ink';
import React from 'react';
import { useSlot } from '../primitives';

export function AssistantLine({ override }: { override?: React.ReactNode } = {}): React.ReactElement | null {
  const slotNodes = useSlot('assistantLine');
  const nodes = override === undefined ? slotNodes : [override];
  if (nodes.length === 0) return null;
  return (
    <Box flexShrink={0}>
      <Text dimColor={true}>
        {nodes.map((n, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: slots have no stable id; order is fixed per render
          <React.Fragment key={`slot-${i}`}>
            {i > 0 ? '  ' : ''}
            {n}
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
