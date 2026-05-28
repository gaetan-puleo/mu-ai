/**
 * Tracks the active primary agent + a one-shot override.
 *
 * Hosts that allow Tab-cycling between primary agents (Build / Plan / …)
 * and `@<primary>` override-on-next-turn share the same state machine:
 *   - the active primary persists across turns
 *   - the override fires for exactly one turn then clears on idle
 *   - swapping the active primary persists to disk so restart preserves it
 *
 * This helper bundles that logic so hosts wire one object through to
 * `bootstrap({ getActivePrimary })` and to the TUI options, instead of
 * threading four getters/setters and a mutable name through the bin.
 */
import type { SubAgent } from './types';

export interface PrimaryAgentStateOptions {
  /** Every primary agent (`type: primary`) loaded from disk. */
  agents: SubAgent[];
  /** Name to restore from persisted state. Falls back to the first agent when missing. */
  initialName?: string;
  /** Called when the active primary changes. Hosts persist the new name. */
  onActiveChange?: (name: string) => void;
}

export interface PrimaryAgentState {
  /** Effective primary for the next turn (override if set, otherwise active). */
  effective(): SubAgent | undefined;
  /** The persistent active primary (ignores override). */
  active(): SubAgent | undefined;
  /** One-shot override set by `@<primary>` mentions. Cleared on idle. */
  override(): SubAgent | undefined;
  /**
   * Switch the active primary by name. No-op when `name` is unknown. Fires
   * `onActiveChange` only when the active name actually changes.
   */
  setActive(name: string): void;
  /** Pass `undefined` to clear (e.g. when the runtime returns to idle). */
  setOverride(agent: SubAgent | undefined): void;
}

export function createPrimaryAgentState(opts: PrimaryAgentStateOptions): PrimaryAgentState {
  const byName = new Map(opts.agents.map((a) => [a.name, a] as const));
  let active: SubAgent | undefined = opts.initialName ? byName.get(opts.initialName) ?? opts.agents[0] : opts.agents[0];
  let override: SubAgent | undefined;

  return {
    effective: () => override ?? active,
    active: () => active,
    override: () => override,
    setActive(name) {
      const next = byName.get(name);
      if (!next || next === active) return;
      active = next;
      opts.onActiveChange?.(next.name);
    },
    setOverride(agent) {
      override = agent && byName.get(agent.name) === agent ? agent : undefined;
    },
  };
}
