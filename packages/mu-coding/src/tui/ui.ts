/**
 * Plugin-facing UI helpers. Each function dispatches into the React store
 * via `safeDispatch` and returns a Promise that resolves when the modal
 * has been closed (whether by the user picking something or cancelling).
 *
 * Equivalent to the old `InkUIService.{confirm,select,input,toast}` API
 * but built on the new ModalKind/Action store rather than a bespoke
 * subscription service.
 *
 * If the TUI isn't mounted, every modal helper resolves immediately with
 * the "cancelled" sentinel (`false` / `null`) so headless callers don't
 * deadlock.
 */

import type { Toast } from './state/uiStore';
import { safeDispatch } from './dispatchSlot';
import { getDispatch } from './dispatchSlot';

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
}

export interface SelectOptions {
  title: string;
  options: string[];
  placeholder?: string;
}

export interface InputOptions {
  title: string;
  placeholder?: string;
}

/** Yes/No prompt. Resolves `false` on cancel (escape, "No"). */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (!getDispatch()) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    safeDispatch({
      type: 'modal_open',
      modal: { kind: 'confirm', title: opts.title, message: opts.message, resolve },
    });
  });
}

/** Filterable single-choice prompt. Resolves `null` on cancel. */
export function select(opts: SelectOptions): Promise<string | null> {
  if (!getDispatch()) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    safeDispatch({
      type: 'modal_open',
      modal: {
        kind: 'select',
        title: opts.title,
        options: opts.options,
        placeholder: opts.placeholder,
        resolve,
      },
    });
  });
}

/** Single-line text prompt. Resolves `null` on empty/cancel. */
export function input(opts: InputOptions): Promise<string | null> {
  if (!getDispatch()) return Promise.resolve(null);
  return new Promise<string | null>((resolve) => {
    safeDispatch({
      type: 'modal_open',
      modal: { kind: 'input', title: opts.title, placeholder: opts.placeholder, resolve },
    });
  });
}

/** Push a toast onto the toast layer. Auto-dismisses after the layer's timeout. */
export function notify(message: string, level: Toast['level'] = 'info'): void {
  safeDispatch({ type: 'toast_push', toast: { id: genId('t'), message, level } });
}
