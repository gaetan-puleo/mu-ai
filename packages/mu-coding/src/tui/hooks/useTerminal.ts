import { useEffect, useState } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

function readSize(): TerminalSize {
  return {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

export function useTerminal(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(readSize);

  useEffect(() => {
    const onResize = (): void => setSize(readSize());
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
