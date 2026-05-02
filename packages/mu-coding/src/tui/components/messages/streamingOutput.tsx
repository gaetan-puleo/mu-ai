import { Box, Text } from 'ink';
import { useTheme } from '../../context/ThemeContext';
import { ReasoningBlock } from './reasoningBlock';

export function StreamingOutput({ currentText, currentReasoning }: { currentText: string; currentReasoning: string }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      {currentReasoning && <ReasoningBlock reasoning={currentReasoning} />}
      <Text wrap="wrap">
        {currentText}
        <Text color={theme.input.cursor} inverse={true}>
          ▎
        </Text>
      </Text>
    </Box>
  );
}
