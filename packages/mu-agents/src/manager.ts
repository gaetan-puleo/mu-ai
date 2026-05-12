import { loadSettings, saveSettings } from './settings';
import type { AgentDefinition } from './types';

type Listener = (active: AgentDefinition | undefined, sessionId: string | null) => void;

type AgentsChangedListener = (snapshot: { primary: AgentDefinition[]; subagent: AgentDefinition[] }) => void;

interface AgentManagerOptions {
  primary: AgentDefinition[];
  subagent: AgentDefinition[];
  settingsPath: string;
}

/**
 * Owns the active primary agent state. Session-scoped: each session has
 * its own active agent via `getActiveFor(sessionId)`. The persisted
 * global default is used as fallback when a session hasn't set one.
 *
 * There is no `getActive()` or `setActive()` — all access is
 * session-scoped. Pass `null` as `sessionId` for the global default.
 */
export class AgentManager {
  private primary: AgentDefinition[];
  private subagentList: AgentDefinition[];
  private settingsPath: string;
  private globalDefault: string;
  private perSession: Map<string, string> = new Map();
  private listeners: Set<Listener> = new Set();
  private agentsChangedListeners: Set<AgentsChangedListener> = new Set();

  constructor(options: AgentManagerOptions) {
    this.primary = options.primary;
    this.subagentList = options.subagent;
    this.settingsPath = options.settingsPath;
    const persisted = loadSettings(this.settingsPath).currentAgent;
    const fallback = this.primary[0]?.name ?? '';
    this.globalDefault = persisted && this.primary.some((a) => a.name === persisted) ? persisted : fallback;
  }

  getPrimary(): AgentDefinition[] {
    return this.primary;
  }

  getSubagents(): AgentDefinition[] {
    return this.subagentList;
  }

  getSubagent(name: string): AgentDefinition | undefined {
    return this.subagentList.find((a) => a.name === name);
  }

  /**
   * Session-scoped active agent. When `sessionId` is non-null and has
   * an override, returns that. Otherwise returns the global default.
   * Pass `null` for the global default.
   */
  getActiveFor(sessionId: string | null): AgentDefinition | undefined {
    const name = sessionId
      ? (this.perSession.get(sessionId) ?? this.globalDefault)
      : this.globalDefault;
    return this.primary.find((a) => a.name === name);
  }

  /**
   * Set the active agent for a session. When `sessionId` is `null`,
   * sets the global default (persisted to disk). Per-session overrides
   * are ephemeral.
   */
  setActiveFor(name: string, sessionId: string | null): boolean {
    const agent = this.primary.find((a) => a.name === name);
    if (!agent) return false;
    if (sessionId) {
      const prev = this.perSession.get(sessionId);
      if (prev === name) return false;
      this.perSession.set(sessionId, name);
    } else {
      if (this.globalDefault === name) return false;
      this.globalDefault = name;
      saveSettings(this.settingsPath, { currentAgent: name });
    }
    for (const fn of this.listeners) fn(agent, sessionId);
    return true;
  }

  clearSessionAgent(sessionId: string): void {
    this.perSession.delete(sessionId);
  }

  /** Cycle the global default to the next primary agent. */
  cycle(): AgentDefinition | undefined {
    if (this.primary.length === 0) return undefined;
    const idx = this.primary.findIndex((a) => a.name === this.globalDefault);
    const next = this.primary[(idx + 1) % this.primary.length];
    if (!next) return undefined;
    this.setActiveFor(next.name, null);
    return next;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onAgentsChanged(listener: AgentsChangedListener): () => void {
    this.agentsChangedListeners.add(listener);
    return () => {
      this.agentsChangedListeners.delete(listener);
    };
  }

  setAgents(primary: AgentDefinition[], subagent: AgentDefinition[]): void {
    this.primary = primary;
    this.subagentList = subagent;
    const stillExists = this.primary.some((a) => a.name === this.globalDefault);
    if (!stillExists) {
      this.globalDefault = this.primary[0]?.name ?? '';
    }
    for (const [sid, name] of this.perSession) {
      if (!this.primary.some((a) => a.name === name)) {
        this.perSession.delete(sid);
      }
    }
    const active = this.getActiveFor(null);
    for (const fn of this.listeners) fn(active, null);
    const snapshot = { primary: this.primary, subagent: this.subagentList };
    for (const fn of this.agentsChangedListeners) fn(snapshot);
  }
}
