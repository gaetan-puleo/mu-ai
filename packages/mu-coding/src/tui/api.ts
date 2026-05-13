import type { Message } from 'mu-core';
import type { ReactNode } from 'react';
import type { StatusSegment } from './state/uiStore';

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';
export type MessageRenderer = (msg: Message) => ReactNode;

/**
 * mu-coding TUI extension surface for plugins. Available only when the Ink
 * TUI is mounted — `getMuCodingTUI()` returns undefined otherwise so plugins
 * degrade gracefully.
 */
export interface MuCodingTUI {
  shortcut(key: string, handler: () => void | Promise<void>): () => void;
  setStatus(key: string, segments: StatusSegment[]): void;
  clearStatus(key: string): void;
  notify(message: string, level?: NotifyLevel): void;
  /** Register a renderer keyed by tool name (e.g. 'bash', 'edit'). */
  renderer(toolName: string, render: MessageRenderer): () => void;
}

let _tui: MuCodingTUI | undefined;

export function getMuCodingTUI(): MuCodingTUI | undefined {
  return _tui;
}

/** @internal — called by renderApp during mount/unmount. */
export function _setMuCodingTUI(tui: MuCodingTUI | undefined): void {
  _tui = tui;
}
