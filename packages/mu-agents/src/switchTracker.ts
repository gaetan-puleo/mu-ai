/**
 * Tracks which primary agents have been "active" since the user last sent a
 * message. The list excludes the agent that is currently active when the
 * next user turn fires; we only inject a context note about agents that
 * actually held the floor previously.
 *
 * Order matters: we preserve the chronological sequence of agents the user
 * cycled through (deduped) so the LLM gets the full lineage. Stable output
 * for identical switch sequences also helps with prompt caching.
 */
export interface AgentSwitchTracker {
  /** Agents that have held the floor since the last send (excluding `current`). */
  traversed: string[];
  /** The agent name currently considered active by the tracker. */
  current: string | null;
}

export function createAgentSwitchTracker(): AgentSwitchTracker {
  return { traversed: [], current: null };
}

/** Record a transition to `next`, deduping repeats and keeping order. */
export function recordSwitch(tracker: AgentSwitchTracker, next: string): void {
  if (tracker.current === null) {
    tracker.current = next;
    return;
  }
  if (tracker.current === next) return;
  // Push the agent we're leaving so the next user turn reports it.
  if (!tracker.traversed.includes(tracker.current)) {
    tracker.traversed.push(tracker.current);
  }
  tracker.current = next;
}

/** Reset the tracker — called when the session is wiped (e.g. /new). */
export function resetTracker(tracker: AgentSwitchTracker, current: string | null): void {
  tracker.traversed = [];
  tracker.current = current;
}

/**
 * Build the hidden context note for the next LLM call when at least one
 * other agent handled the conversation since the last user send. Returns
 * `null` when no injection is warranted.
 */
export function buildAgentSwitchNote(tracker: AgentSwitchTracker, currentName: string): string | null {
  const others = tracker.traversed.filter((name) => name !== currentName);
  if (others.length === 0) return null;
  const list = others.map((name) => `'${name}'`).join(', ');
  return `[Internal context] Earlier turns in this conversation were handled by the following agent(s) before you took over: ${list}. You are now agent '${currentName}' and are responsible for replying.`;
}
