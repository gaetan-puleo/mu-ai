import { Box, Text } from 'ink';

interface ToolHeaderProps {
  /** The tool name shown after the status icon. */
  name: string;
  /** Optional subtitle (typically the file path or command). */
  subtitle?: string;
  /** When true, render with the failure styling. */
  error?: boolean;
}

/**
 * Shared header used by every tool-output renderer (read/write/edit/bash).
 * Centralizes the ✓/✗ glyphs, color choice, and subtitle formatting so each
 * specific component doesn't have to re-implement the same layout.
 */
export function ToolHeader({ name, subtitle, error = false }: ToolHeaderProps) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={error ? 'red' : 'green'} bold={true}>
        {error ? '✗' : '✓'} {name}
      </Text>
      {subtitle && <Text dimColor={true}> {subtitle}</Text>}
    </Box>
  );
}
