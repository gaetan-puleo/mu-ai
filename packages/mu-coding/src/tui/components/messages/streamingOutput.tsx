import { Box, Text } from 'ink';
import { ReasoningBlock } from './reasoningBlock';

export function StreamingOutput({ currentText, currentReasoning }: { currentText: string; currentReasoning: string }) {
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      {currentReasoning && <ReasoningBlock reasoning={currentReasoning} />}
      <Text wrap="wrap">
        {currentText}
        <Text inverse={true}>▎</Text>
      </Text>
    </Box>
  );
}
