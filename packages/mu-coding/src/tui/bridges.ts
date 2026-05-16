import type { Session } from 'mu-core';

// ─────────────────────────────────────────────────────────────────────────────
// Bridge singletons — shared mutable state between React and non-React code.
//
// Each bridge is a module-level object that React components rebind on every
// render via useEffect. Non-React code (channel plugin, slash commands,
// runTui) reads/writes the bridge to communicate across the boundary.
//
// Owner checsheets:
//   EXIT_BRIDGE        — React writes (useEffect), channel.stop reads
//   QUIT_BRIDGE        — React writes (useEffect), /quit command invokes
//   NEW_SESSION_BRIDGE — React writes (useEffect), /new command invokes
//   SESSIONS_BRIDGE    — React writes (useEffect), /sessions command invokes
//   MODEL_PICKER_BRIDGE— React writes (useEffect), /model command invokes
//   CURRENT_SESSION_BRIDGE — React writes (useEffect), slots/runTui read
//   ACTIVE_MODEL_BRIDGE   — runTui writes initial, Chat/pickModel update, Chat/submit read
//   AGENT_COLOR_BRIDGE    — runTui writes, Chat reads (user message border)
//   BASH_BRIDGE           — channel.register writes, Chat/submit calls
//   MODEL_CHANGE_BRIDGE   — runTui writes handler, Chat/submit invokes
//   CTX_BRIDGE            — Chat/submit writes usage, runTui writes total, StatusBar reads
//   APPROVAL_BRIDGE       — Chat writes (useEffect), approvalBridge pushes
// ─────────────────────────────────────────────────────────────────────────────

export const EXIT_BRIDGE: { fn: (() => void) | null } = { fn: null };
export const QUIT_BRIDGE: { fn: (() => void) | null } = { fn: null };
export const NEW_SESSION_BRIDGE: { fn: (() => void | Promise<void>) | null } = { fn: null };
export const SESSIONS_BRIDGE: { fn: (() => void) | null } = { fn: null };
export const MODEL_PICKER_BRIDGE: { fn: (() => void) | null } = { fn: null };
export const CURRENT_SESSION_BRIDGE: { get: (() => Session) | null } = { get: null };
export const ACTIVE_MODEL_BRIDGE: { value: string } = { value: '' };
export const AGENT_COLOR_BRIDGE: { get: ((session: Session) => string | undefined) | null } = {
  get: null,
};
export const BASH_BRIDGE: {
  run: ((cmd: string, signal?: AbortSignal) => Promise<{ content: string; error: boolean }>) | null;
} = { run: null };
export const MODEL_CHANGE_BRIDGE: { fn: ((newModel: string) => void) | null } = { fn: null };

export interface CtxSnapshot {
  used?: number;
  total?: number;
  cached?: number;
}

export const CTX_BRIDGE: {
  bySession: Map<string, CtxSnapshot>;
  totalForModel?: number;
} = { bySession: new Map() };

export const USER_BACKGROUND = '#1a1a1a';

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
