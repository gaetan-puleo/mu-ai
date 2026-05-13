/**
 * Minimal UI surface mu-repomap depends on. Hosts (e.g. mu-coding TUI) inject
 * an implementation; otherwise repomap falls back to stdout/stderr.
 */
export interface UIService {
  notify: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
  setStatus: (key: string, text: string) => void;
  clearStatus: (key: string) => void;
}

/**
 * Repomap logger — abstracts where progress and errors go.
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
