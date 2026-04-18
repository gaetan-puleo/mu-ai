import { Box, Text, useStdout } from 'ink';
import { useState } from 'react';

export interface Toast {
  id: number;
  message: string;
  color?: string;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = (message: string, color?: string, durationMs = 2000) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, color }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  };

  return { toasts, show };
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  const { stdout } = useStdout();
  const columns = stdout.columns;

  if (toasts.length === 0) {
    return null;
  }

  return (
    <Box position="absolute" top={0} left={0} width={columns} justifyContent="flex-end" paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={1}>
        {toasts.map((t) => (
          <Box key={t.id} backgroundColor="#1a1a1a" paddingX={2} paddingY={0}>
            <Text color={t.color ?? 'green'}>{t.message}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
