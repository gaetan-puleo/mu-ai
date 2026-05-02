import type { UIService } from 'mu-core';

export type DialogType = 'confirm' | 'select' | 'input';

export interface DialogRequest {
  id: number;
  type: DialogType;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  resolve: (value: unknown) => void;
}

export interface ToastRequest {
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

let nextDialogId = 0;

type ToastListener = (toast: ToastRequest) => void;
type StatusListener = (entries: Map<string, string>) => void;

/**
 * InkUIService bridges plugin UI requests with Ink's React rendering.
 *
 * All event channels (dialogs, toasts, status) follow the same multi-listener
 * pattern: `subscribe`/`onToast`/`onStatusChange` return an unsubscribe
 * function. This lets multiple components observe the same service safely
 * (e.g. during hot-reload or component swaps) without one handler clobbering
 * another.
 *
 * Toasts emitted before any listener subscribes are buffered and replayed
 * to the first subscriber; this avoids losing plugin-load errors emitted
 * before the TUI mounts.
 *
 * Implements `UIService` from `mu-agents` — gives nominal typing so a
 * change on either side fails the build.
 */
export class InkUIService implements UIService {
  private dialogQueue: DialogRequest[] = [];
  private dialogSubscribers: Set<() => void> = new Set();
  private toastListeners: Set<ToastListener> = new Set();
  private pendingToasts: ToastRequest[] = [];
  private statusMap: Map<string, string> = new Map();
  private statusListeners: Set<StatusListener> = new Set();

  // ─── Dialog Subscription (used by DialogLayer) ──────────────────────────

  subscribe(fn: () => void): () => void {
    this.dialogSubscribers.add(fn);
    return () => {
      this.dialogSubscribers.delete(fn);
    };
  }

  private notifyDialogSubscribers(): void {
    for (const fn of this.dialogSubscribers) {
      fn();
    }
  }

  /** Get the current dialog at the front of the queue */
  currentDialog(): DialogRequest | null {
    return this.dialogQueue[0] ?? null;
  }

  /** Resolve the current dialog and advance the queue */
  resolveDialog(value: unknown): void {
    const dialog = this.dialogQueue.shift();
    if (dialog) {
      dialog.resolve(value);
      this.notifyDialogSubscribers();
    }
  }

  /** Cancel/dismiss the current dialog */
  cancelDialog(): void {
    const dialog = this.dialogQueue.shift();
    if (dialog) {
      dialog.resolve(dialog.type === 'confirm' ? false : null);
      this.notifyDialogSubscribers();
    }
  }

  // ─── Toast ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to toast events. Returns an unsubscribe function. If toasts
   * were emitted before any listener attached, they are replayed to the
   * first subscriber once.
   */
  onToast(callback: ToastListener): () => void {
    this.toastListeners.add(callback);
    if (this.pendingToasts.length > 0) {
      const buffered = this.pendingToasts;
      this.pendingToasts = [];
      for (const toast of buffered) {
        callback(toast);
      }
    }
    return () => {
      this.toastListeners.delete(callback);
    };
  }

  // ─── Status ─────────────────────────────────────────────────────────────

  onStatusChange(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private emitStatus(): void {
    for (const fn of this.statusListeners) {
      fn(this.statusMap);
    }
  }

  getStatusEntries(): Map<string, string> {
    return new Map(this.statusMap);
  }

  // ─── Plugin UI Methods ──────────────────────────────────────────────────

  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void {
    const toast: ToastRequest = { message, level: level ?? 'info' };
    if (this.toastListeners.size === 0) {
      this.pendingToasts.push(toast);
      return;
    }
    for (const listener of this.toastListeners) {
      listener(toast);
    }
  }

  confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.dialogQueue.push({
        id: nextDialogId++,
        type: 'confirm',
        title,
        message,
        resolve: resolve as (value: unknown) => void,
      });
      this.notifyDialogSubscribers();
    });
  }

  select(title: string, options: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialogQueue.push({
        id: nextDialogId++,
        type: 'select',
        title,
        options,
        resolve: resolve as (value: unknown) => void,
      });
      this.notifyDialogSubscribers();
    });
  }

  input(title: string, placeholder?: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialogQueue.push({
        id: nextDialogId++,
        type: 'input',
        title,
        placeholder,
        resolve: resolve as (value: unknown) => void,
      });
      this.notifyDialogSubscribers();
    });
  }

  setStatus(key: string, text: string): void {
    this.statusMap.set(key, text);
    this.emitStatus();
  }

  clearStatus(key: string): void {
    this.statusMap.delete(key);
    this.emitStatus();
  }
}
