/**
 * UIService is the host-supplied bridge that lets plugins prompt the user,
 * surface notifications, and pin status text without coupling to a specific
 * renderer (Ink, plain console, etc.). The TUI host (mu-coding) implements
 * this with `InkUIService`; CLI / single-shot hosts can use `ConsoleUIService`.
 *
 * Plugins receive a `UIService` either directly through their own factory
 * config (e.g. `mu-pi-compat`) or via `PluginContext.ui` when one is provided.
 */
export type UINotifyLevel = 'info' | 'success' | 'warning' | 'error';

export interface UIService {
  notify: (message: string, level?: UINotifyLevel) => void;
  confirm: (title: string, message: string) => Promise<boolean>;
  select: (title: string, options: string[]) => Promise<string | null>;
  input: (title: string, placeholder?: string) => Promise<string | null>;
  setStatus: (key: string, text: string) => void;
  clearStatus: (key: string) => void;
}

/**
 * Fallback UIService for non-interactive (single-shot) mode.
 * Routes notifications to stderr; auto-resolves prompts in deterministic ways
 * so non-interactive runs never block.
 */
export class ConsoleUIService implements UIService {
  notify(message: string, level?: UINotifyLevel): void {
    const prefix = level === 'error' ? '[ERROR]' : level === 'warning' ? '[WARN]' : '[INFO]';
    console.error(`${prefix} ${message}`);
  }
  async confirm(_title: string, message: string): Promise<boolean> {
    console.error(`[CONFIRM] ${message} (auto-accepting in non-interactive mode)`);
    return true;
  }
  async select(_title: string, options: string[]): Promise<string | null> {
    console.error('[SELECT] Auto-selecting first option in non-interactive mode');
    return options[0] ?? null;
  }
  async input(_title: string, _placeholder?: string): Promise<string | null> {
    console.error('[INPUT] Cannot prompt in non-interactive mode');
    return null;
  }
  setStatus(_key: string, _text: string): void {
    /* no-op in console mode */
  }
  clearStatus(_key: string): void {
    /* no-op in console mode */
  }
}
