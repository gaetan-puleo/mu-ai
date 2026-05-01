import { useCallback, useRef, useState } from 'react';
import { restoreTerminal, type ShutdownFn } from '../../app/shutdown';

function useDoublePress(timeoutMs: number) {
  const [warning, setWarning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback(() => {
    if (warning) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return true;
    }
    setWarning(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setWarning(false);
      timerRef.current = null;
    }, timeoutMs);
    return false;
  }, [warning, timeoutMs]);

  return { warning, confirm };
}

export interface AbortState {
  controllerRef: React.RefObject<AbortController | null>;
  quitWarning: boolean;
  abortWarning: boolean;
  onCtrlC: () => void;
  onEsc: () => void;
}

export function useAbort(
  streaming: boolean,
  controllerRef: React.RefObject<AbortController | null>,
  exit: () => void,
  timeoutMs: number,
  shutdown?: ShutdownFn,
): AbortState {
  const { warning: quitWarning, confirm: onCtrlC } = useDoublePress(timeoutMs);
  const { warning: abortWarning, confirm: onEsc } = useDoublePress(timeoutMs);

  const handleCtrlC = useCallback(() => {
    if (streaming && controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      return;
    }
    if (!onCtrlC()) {
      return;
    }
    // Restore the terminal first so even a hanging shutdown leaves a usable
    // prompt, then unmount Ink (fires `useScroll`/etc. cleanups), then run
    // the registry shutdown which `process.exit`s when complete.
    restoreTerminal();
    exit();
    if (shutdown) {
      void shutdown(0);
    } else {
      // Fallback for callers that didn't wire a shutdown function.
      setTimeout(() => process.exit(0), 500);
    }
  }, [streaming, onCtrlC, exit, controllerRef, shutdown]);

  const handleEsc = useCallback(() => {
    if (!(streaming && controllerRef.current)) {
      return;
    }
    if (onEsc()) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, [streaming, onEsc, controllerRef]);

  return { controllerRef, quitWarning, abortWarning, onCtrlC: handleCtrlC, onEsc: handleEsc };
}
