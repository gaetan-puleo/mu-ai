import { Box, Text } from 'ink';

export function ReasoningBlock({ reasoning }: { reasoning: string }) {
  return (
    <Box flexDirection="column" marginTop={0} marginBottom={1}>
      <Text color="yellow" italic={true}>
        thinking
      </Text>
      <Text dimColor={true} italic={true} wrap="wrap">
        {reasoning}
      </Text>
    </Box>
  );
}
