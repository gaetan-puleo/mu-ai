import process from 'node:process';

export async function drainStdin(opts?: { maxMs?: number; idleMs?: number }): Promise<void> {
  const maxMs = opts?.maxMs ?? 200;
  const idleMs = opts?.idleMs ?? 30;

  let lastDataTime = Date.now();
  const onData = (): void => {
    lastDataTime = Date.now();
  };

  process.stdin.on('data', onData);
  const endTime = Date.now() + maxMs;

  try {
    while (true) {
      const now = Date.now();
      if (now - endTime >= 0) break;
      if (now - lastDataTime >= idleMs) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(idleMs, endTime - now)));
    }
  } finally {
    process.stdin.removeListener('data', onData);
  }
}
