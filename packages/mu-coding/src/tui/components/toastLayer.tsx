import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect } from 'react';
import { useDispatch, useUi } from '../state/AppContext';
import type { Toast } from '../state/uiStore';
import { useTheme } from '../theme/ThemeContext';

const TOAST_TIMEOUT_MS = 60_000;

function levelColor(level: Toast['level'], theme: ReturnType<typeof useTheme>): string {
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

/**
 * Schedules a `toast_dismiss` dispatch `TOAST_TIMEOUT_MS` after the toast
 * first becomes visible. One effect per toast id keyed by the toast's
 * stable identity so dismissing one (e.g. via escape) doesn't cancel the
 * timer for another. Cleanup clears the timer if the toast was dispatched
 * away before the timeout fired (idempotency: dispatching `toast_dismiss`
 * twice is a no-op).
 */
function ToastTimer({ id }: { id: string }) {
  const dispatch = useDispatch();
  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: 'toast_dismiss', id }), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [dispatch, id]);
  return null;
}

/**
 * Top-right toast stack. Auto-dismisses each card after 60s; the user
 * can also press escape to dismiss the oldest one — but only when no
 * modal is open, so escape stays available for modal cancellation.
 */
export function ToastLayer() {
  const theme = useTheme();
  const { toasts, modal } = useUi();
  const dispatch = useDispatch();
  const { stdout } = useStdout();
  const columns = stdout.columns;

  useInput(
    (_input, key) => {
      if (toasts.length > 0 && key.escape) {
        const oldest = toasts[0];
        if (oldest) dispatch({ type: 'toast_dismiss', id: oldest.id });
      }
    },
    { isActive: !modal && toasts.length > 0 },
  );

  if (toasts.length === 0) return null;

  const maxWidth = Math.max(20, Math.min(60, columns - 4));

  return (
    <Box position="absolute" top={0} left={0} width={columns} justifyContent="flex-end" paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={1}>
        {toasts.map((t) => {
          const color = levelColor(t.level, theme);
          return (
            <Box
              key={t.id}
              backgroundColor={theme.colors.toastBackground}
              paddingX={2}
              paddingY={0}
              width={maxWidth}
            >
              <ToastTimer id={t.id} />
              <Box flexGrow={1} flexShrink={1}>
                <Text color={color} wrap="wrap">
                  {t.message}
                </Text>
              </Box>
              <Box marginLeft={1} flexShrink={0}>
                <Text color={theme.colors.muted} dimColor>
                  [esc]✕
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
