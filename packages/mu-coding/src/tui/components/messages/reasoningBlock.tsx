import { Box, Text } from 'ink';
import { useTheme } from '../../context/ThemeContext';

export function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      <Text color={theme.reasoning.title} italic={true}>
        thinking
      </Text>
      <Text color={theme.reasoning.body} italic={true} wrap="wrap">
        {reasoning}
      </Text>
    </Box>
  );
}
