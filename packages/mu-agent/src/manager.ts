import { loadSettings, saveSettings } from './settings';
import type { AgentDefinition } from './types';

type Listener = (active: AgentDefinition | undefined) => void;

interface AgentManagerOptions {
  /** Available primary agents (already merged from defaults + overrides). */
  primary: AgentDefinition[];
  /** Available subagents. Used by the subagent tools, not by manager state. */
  subagent: AgentDefinition[];
  /** Path to persist `currentAgent` between sessions. */
  settingsPath: string;
}

/**
 * Owns the "currently active primary agent" state. UI surfaces (status
 * indicator, system prompt injection, tool filter) subscribe and react.
 */
export class AgentManager {
  private primary: AgentDefinition[];
  private subagentList: AgentDefinition[];
  private settingsPath: string;
  private activeName: string;
  private listeners: Set<Listener> = new Set();

  constructor(options: AgentManagerOptions) {
    this.primary = options.primary;
    this.subagentList = options.subagent;
    this.settingsPath = options.settingsPath;
    const persisted = loadSettings(this.settingsPath).currentAgent;
    const fallback = this.primary[0]?.name ?? '';
    this.activeName = persisted && this.primary.some((a) => a.name === persisted) ? persisted : fallback;
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

  getActive(): AgentDefinition | undefined {
    return this.primary.find((a) => a.name === this.activeName);
  }

  setActive(name: string): boolean {
    const agent = this.primary.find((a) => a.name === name);
    if (!agent) return false;
    if (this.activeName === name) return false;
    this.activeName = name;
    saveSettings(this.settingsPath, { currentAgent: name });
    for (const fn of this.listeners) fn(agent);
    return true;
  }

  /** Move to the next primary agent, wrapping around. Returns the new active. */
  cycle(): AgentDefinition | undefined {
    if (this.primary.length === 0) return undefined;
    const idx = this.primary.findIndex((a) => a.name === this.activeName);
    const next = this.primary[(idx + 1) % this.primary.length];
    this.setActive(next.name);
    return next;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
