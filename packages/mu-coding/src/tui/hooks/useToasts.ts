import { useEffect } from 'react';
import { useDispatch, useUi } from '../state/AppContext';

const TOAST_TTL_MS = 4000;

/**
 * Auto-dismiss toasts after a TTL. Mounted once at the App root.
 */
export function useToasts(): void {
  const dispatch = useDispatch();
  const { toasts } = useUi();

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dispatch({ type: 'toast_dismiss', id: t.id }), TOAST_TTL_MS),
    );
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [toasts, dispatch]);
}
