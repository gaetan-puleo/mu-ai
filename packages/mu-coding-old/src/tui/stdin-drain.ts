/**
 * Drain pending stdin bytes before tearing down the TUI.
 *
 * Why: when the TUI exits, the kernel input buffer can still contain bytes
 * the user typed in the final few milliseconds (Kitty key-release events,
 * a stray Ctrl+D, mouse events, etc.). If we restore cooked mode before
 * those bytes are consumed, they get re-interpreted by the parent shell —
 * most visibly, a buffered Ctrl+D can close the shell over SSH.
 *
 * Strategy mirrors pi's `ProcessTerminal.drainInput`: attach a probe
 * listener purely to track the time of the last `data` event, then poll
 * until either (a) `idleMs` of silence has elapsed or (b) we hit the
 * `maxMs` wallclock cap. The probe is detached in `finally`.
 *
 * The caller is expected to follow up with `process.stdin.pause()` before
 * raw mode is restored.
 */
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
      const timeLeft = endTime - now;
      if (timeLeft <= 0) break;
      if (now - lastDataTime >= idleMs) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(idleMs, timeLeft)));
    }
  } finally {
    process.stdin.removeListener('data', onData);
  }
}
