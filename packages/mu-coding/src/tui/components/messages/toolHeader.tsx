import { Box, Text } from 'ink';
import { useTheme } from '../../theme/ThemeContext';

export interface ToolHeaderProps {
  name: string;
  subtitle?: string;
  error?: boolean;
}

/**
 * Header row used above tool output (Read, Write, Edit, etc.).
 *  - `name`     the verb / tool id (e.g. "edit_file")
 *  - `subtitle` usually the operand (path, url)
 *  - `error`    flips the verb colour to the error palette and prepends "!"
 *
 * Restored from `5c5ae8c:.../messages/ToolHeader.tsx`. The current TUI
 * inlined a similar row in each output component; centralising it again
 * matches the older visual rhythm where every tool result was preceded
 * by the same compact header.
 */
export function ToolHeader({ name, subtitle, error }: ToolHeaderProps) {
  const theme = useTheme();
  const color = error ? theme.colors.error : theme.colors.tool;
  return (
    <Box flexDirection="row">
      <Text color={color} bold>
        {error ? '! ' : '• '}
        {name}
      </Text>
      {subtitle ? (
        <Text dimColor wrap="truncate-end">
          {' '}
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
}
