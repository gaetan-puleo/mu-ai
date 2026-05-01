import { Box, Text, useInput, useStdout } from 'ink';
import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
  color?: string;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, color?: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, color }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissFirst = useCallback(() => {
    setToasts((prev) => prev.slice(1));
  }, []);

  return { toasts, show, dismiss, dismissFirst };
}

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
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
          <Box key={t.id} backgroundColor="#1a1a1a" paddingX={2} paddingY={0} width={maxWidth}>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={t.color ?? 'green'} wrap="wrap">
                {t.message}
              </Text>
            </Box>
            <Box marginLeft={1} flexShrink={0}>
              <Text color="gray" dimColor={true}>
                [esc]✕
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
