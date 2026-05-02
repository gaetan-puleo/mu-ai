import { Box, Text, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';

export interface Toast {
  id: number;
  message: string;
  color?: string;
}

const TOAST_TIMEOUT_MS = 60_000;

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, color?: string) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, color }]);
      const timer = setTimeout(() => dismiss(id), TOAST_TIMEOUT_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  const dismissFirst = useCallback(() => {
    setToasts((prev) => {
      const [first, ...rest] = prev;
      if (first) {
        const timer = timersRef.current.get(first.id);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(first.id);
        }
      }
      return rest;
    });
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { toasts, show, dismiss, dismissFirst };
}

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = stdout.columns;

  useInput((_input, key) => {
    if (toasts.length > 0 && key.escape) {
      onDismiss(toasts[0].id);
    }
  });

  if (toasts.length === 0) {
    return null;
  }

  const maxWidth = Math.min(60, columns - 4);

  return (
    <Box position="absolute" top={0} left={0} width={columns} justifyContent="flex-end" paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={1}>
        {toasts.map((t) => (
          <Box key={t.id} backgroundColor={theme.toast.background} paddingX={2} paddingY={0} width={maxWidth}>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={t.color ?? theme.toast.defaultColor} wrap="wrap">
                {t.message}
              </Text>
            </Box>
            <Box marginLeft={1} flexShrink={0}>
              <Text color={theme.toast.closeHint} dimColor={true}>
                [esc]✕
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
