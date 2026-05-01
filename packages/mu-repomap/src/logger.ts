import type { UIService } from 'mu-agents';

/**
 * Repomap logger — abstracts where progress and errors go.
 *
 * In TUI mode (UIService provided) progress is pinned as a status segment under
 * the `repomap-progress` key (replaced as phases advance, cleared on completion)
 * and notable events (done / error) become toasts. In standalone mode (no
 * UIService) we fall back to stdout/stderr so messages stay visible.
 */
export interface RepomapLogger {
  /** Transient progress text — replaces previous progress. */
  progress: (text: string) => void;
  /** Clear pinned progress. */
  clearProgress: () => void;
  /** A notable, sticky message — TUI shows a toast, console prints to stdout. */
  notify: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
}

const PROGRESS_KEY = 'repomap-progress';

export function createLogger(ui?: UIService): RepomapLogger {
  if (ui) {
    return {
      progress: (text) => ui.setStatus(PROGRESS_KEY, `[repomap] ${text}`),
      clearProgress: () => ui.clearStatus(PROGRESS_KEY),
      notify: (msg, level) => ui.notify(`[repomap] ${msg}`, level),
    };
  }
  return {
    progress: (text) => console.log(`[repomap] ${text}`),
    clearProgress: () => {
      /* no pinned progress in console mode */
    },
    notify: (msg, level) => {
      if (level === 'error' || level === 'warning') {
        console.error(`[repomap] ${msg}`);
      } else {
        console.log(`[repomap] ${msg}`);
      }
    },
  };
}
