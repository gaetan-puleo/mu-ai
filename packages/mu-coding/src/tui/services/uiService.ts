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

/**
 * InkUIService bridges plugin UI requests with ink's React rendering.
 *
 * Dialog methods (confirm, select, input) push requests into a queue.
 * The TUI's DialogLayer component consumes the queue and renders appropriate modals.
 * When the user interacts, the promise is resolved.
 *
 * This class implements the same shape as mu-pi-compat's UIService interface
 * via structural typing — no import needed.
 */
export class InkUIService {
  private dialogQueue: DialogRequest[] = [];
  private subscribers: Set<() => void> = new Set();
  private toastCallback: ((toast: ToastRequest) => void) | null = null;
  private statusMap: Map<string, string> = new Map();
  private statusCallback: ((entries: Map<string, string>) => void) | null = null;

  // ─── Subscription (used by React hooks) ─────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notifySubscribers(): void {
    for (const fn of this.subscribers) {
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
      this.notifySubscribers();
    }
  }

  /** Cancel/dismiss the current dialog */
  cancelDialog(): void {
    const dialog = this.dialogQueue.shift();
    if (dialog) {
      dialog.resolve(dialog.type === 'confirm' ? false : null);
      this.notifySubscribers();
    }
  }

  // ─── Toast ──────────────────────────────────────────────────────────────

  private pendingToasts: ToastRequest[] = [];

  onToast(callback: (toast: ToastRequest) => void): void {
    this.toastCallback = callback;
    // Flush any toasts that fired before the TUI mounted
    for (const toast of this.pendingToasts) {
      callback(toast);
    }
    this.pendingToasts = [];
  }

  // ─── Status ─────────────────────────────────────────────────────────────

  onStatusChange(callback: (entries: Map<string, string>) => void): void {
    this.statusCallback = callback;
  }

  getStatusEntries(): Map<string, string> {
    return new Map(this.statusMap);
  }

  // ─── Plugin UI Methods ──────────────────────────────────────────────────

  notify(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void {
    const toast: ToastRequest = { message, level: level ?? 'info' };
    if (this.toastCallback) {
      this.toastCallback(toast);
    } else {
      this.pendingToasts.push(toast);
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
      this.notifySubscribers();
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
      this.notifySubscribers();
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
      this.notifySubscribers();
    });
  }

  setStatus(key: string, text: string): void {
    this.statusMap.set(key, text);
    this.statusCallback?.(this.statusMap);
  }

  clearStatus(key: string): void {
    this.statusMap.delete(key);
    this.statusCallback?.(this.statusMap);
  }
}
