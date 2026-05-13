import { Box, Text } from 'ink';
import { useUi } from '../state/AppContext';
import { useTheme } from '../theme/ThemeContext';
import type { Toast } from '../state/uiStore';

function toastColor(level: Toast['level'], theme: ReturnType<typeof useTheme>): string {
  switch (level) {
    case 'success':
      return theme.colors.success;
    case 'warning':
      return theme.colors.warning;
    case 'error':
      return theme.colors.error;
    default:
      return theme.colors.info;
  }
}

export function ToastLayer() {
  const theme = useTheme();
  const { toasts } = useUi();
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column">
      {toasts.map((t) => (
        <Box key={t.id} borderStyle="round" borderColor={toastColor(t.level, theme)} paddingX={1}>
          <Text color={toastColor(t.level, theme)}>{t.message}</Text>
        </Box>
      ))}
    </Box>
  );
}
