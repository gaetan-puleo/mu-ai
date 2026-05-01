import type { PluginRegistry } from 'mu-agents';

/**
 * Escape sequences to disable every SGR mouse-tracking mode the TUI may have
 * enabled (or inherited from a stale prior session). Disabling already-off
 * modes is a no-op, so we send all three defensively to avoid leaking mouse
 * tracking into the parent shell after abort.
 *  - 1000 = X10/normal (press+release)         ← what `useScroll` enables
 *  - 1002 = button-event tracking (press+drag) ← legacy, prior versions
 *  - 1003 = any-event tracking (all motion)    ← belt-and-suspenders
 *  - 1006 = SGR-encoded coordinates extension
 */
const DISABLE_MOUSE_MODE = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l';

/** Restore the kitty keyboard protocol stack — symmetric with renderApp's enable. */
const POP_KITTY_KEYBOARD = '\x1b[<u';

export type ShutdownFn = (code?: number) => Promise<void>;

let registered = false;

/**
 * Install graceful-shutdown handlers and return a `shutdown` function the TUI
 * can invoke directly when the user requests a quit.
 *
 * Coverage:
 *  - terminal close / external kill (SIGHUP, SIGTERM)
 *  - normal Node shutdown via `beforeExit`
 *  - uncaught exceptions / unhandled rejections (best-effort terminal restore)
 *  - explicit quit from `useAbort` (calls the returned `shutdown` directly)
 *
 * SIGINT is intentionally NOT trapped: Ink owns Ctrl+C through the `useInput`
 * hook (`exitOnCtrlC: false` in renderApp) and `useAbort` implements the
 * double-press quit UX, calling the returned function on confirmation.
 *
 * The function is idempotent — concurrent invocations resolve to the same
 * outcome and the handlers fire only once.
 *
 * `getRegistry` is a thunk so the shutdown handle can be created BEFORE the
 * registry (the registry consumes `shutdown` in its plugin context, creating
 * a cycle if both were eager).
 */
export function registerShutdown(getRegistry: () => PluginRegistry | null): ShutdownFn {
  let shuttingDown: Promise<void> | null = null;

  const shutdown: ShutdownFn = (code = 0) => {
    if (shuttingDown) {
      return shuttingDown;
    }
    shuttingDown = (async () => {
      try {
        const registry = getRegistry();
        if (registry) {
          await registry.shutdown();
        }
      } catch (err) {
        console.error('Shutdown error:', err instanceof Error ? err.message : err);
      } finally {
        restoreTerminal();
        // `process.exit` from inside an `async` function still terminates
        // synchronously after the current microtask queue drains.
        process.exit(code);
      }
    })();
    return shuttingDown;
  };

  if (!registered) {
    registered = true;
    process.once('SIGTERM', () => void shutdown(143));
    process.once('SIGHUP', () => void shutdown(129));
    process.once('beforeExit', (code) => void shutdown(code));
    process.once('uncaughtException', (err) => {
      restoreTerminal();
      console.error(err);
      process.exit(1);
    });
    process.once('unhandledRejection', (err) => {
      restoreTerminal();
      console.error(err);
      process.exit(1);
    });
  }

  return shutdown;
}

export function restoreTerminal(): void {
  try {
    process.stdout.write(`${DISABLE_MOUSE_MODE}${POP_KITTY_KEYBOARD}`);
  } catch {
    // stdout may already be closed during teardown — nothing to do.
  }
}
