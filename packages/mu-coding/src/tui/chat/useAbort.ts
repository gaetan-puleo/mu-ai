import type { Session } from 'mu-core';
import { useCallback, useRef, useState } from 'react';
import { restoreTerminal, type ShutdownFn } from '../../app/shutdown';

function useDoublePress(timeoutMs: number) {
  const [warning, setWarning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback(() => {
    if (warning) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setWarning(false);
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
  quitWarning: boolean;
  abortWarning: boolean;
  onCtrlC: () => void;
  onEsc: () => void;
}

export function useAbort(
  streaming: boolean,
  session: Session,
  exit: () => void,
  timeoutMs: number,
  shutdown?: ShutdownFn,
): AbortState {
  const { warning: quitWarning, confirm: onCtrlC } = useDoublePress(timeoutMs);
  const { warning: abortWarning, confirm: onEsc } = useDoublePress(timeoutMs);

  const handleCtrlC = useCallback(() => {
    if (streaming) {
      session.abort();
      return;
    }
    if (!onCtrlC()) {
      return;
    }
    restoreTerminal();
    exit();
    if (shutdown) {
      void shutdown(0);
    } else {
      setTimeout(() => process.exit(0), 500);
    }
  }, [streaming, session, onCtrlC, exit, shutdown]);

  const handleEsc = useCallback(() => {
    if (!streaming) return;
    if (onEsc()) {
      session.abort();
    }
  }, [streaming, session, onEsc]);

  return { quitWarning, abortWarning, onCtrlC: handleCtrlC, onEsc: handleEsc };
}
