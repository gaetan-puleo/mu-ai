import { Box, Text } from 'ink';
import { useTheme } from '../../context/ThemeContext';

export function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const theme = useTheme();
  return (
    <Box marginBottom={0}>
      <Text wrap="wrap">
        <Text color={theme.reasoning.title} italic={true}>
          thinking:{' '}
        </Text>
        <Text color={theme.reasoning.body} italic={true}>
          {reasoning}
        </Text>
      </Text>
    </Box>
  );
}
