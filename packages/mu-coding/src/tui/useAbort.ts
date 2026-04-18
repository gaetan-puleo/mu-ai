import { useCallback, useRef, useState } from 'react';

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
): AbortState {
  const { warning: quitWarning, confirm: onCtrlC } = useDoublePress(timeoutMs);
  const { warning: abortWarning, confirm: onEsc } = useDoublePress(timeoutMs);

  const handleCtrlC = useCallback(() => {
    if (streaming && controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      return;
    }
    if (onCtrlC()) {
      exit();
      setTimeout(() => process.exit(0), 100);
    }
  }, [streaming, onCtrlC, exit, controllerRef]);

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
