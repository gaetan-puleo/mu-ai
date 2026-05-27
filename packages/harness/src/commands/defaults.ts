/**
 * Default commands hosts can register into their CommandRegistry.
 *
 * Each factory takes the deps it needs and returns a Command. Hosts pick
 * which ones to include — none are auto-registered.
 */
import type { SessionStore } from 'mu-core';
import type { SubAgent } from '../sub-agents/types';
import type { Command } from './types';

export interface AgentsCommandDeps {
  getSubAgents: () => SubAgent[];
}

/** `/agents` — list sub-agents available for mention/dispatch. */
export function createAgentsCommand(deps: AgentsCommandDeps): Command {
  return {
    name: 'agents',
    description: 'List available sub-agents',
    run: () => {
      const agents = deps.getSubAgents();
      if (agents.length === 0) {
        return { ok: true, output: '_No agents registered._' };
      }
      const lines = ['**Sub-agents (tag with `@name`)**'];
      for (const a of agents) lines.push(`- \`@${a.name}\` — ${a.description}`);
      return { ok: true, output: lines.join('\n') };
    },
  };
}

export interface SessionsCommandDeps {
  store: SessionStore;
}

/** `/sessions` — list every session in the store. */
export function createSessionsCommand(deps: SessionsCommandDeps): Command {
  return {
    name: 'sessions',
    description: 'List sessions',
    run: () => {
      const sessions = deps.store.list();
      if (sessions.length === 0) return { ok: true, output: '_No sessions yet._' };
      const lines = ['**Sessions**'];
      for (const s of sessions) lines.push(`- \`${s.id}\` — ${s.title ?? '(untitled)'}`);
      return { ok: true, output: lines.join('\n') };
    },
  };
}

export interface HelpCommandDeps {
  /** Returns the registry's command list (typically `registry.list`). */
  list: () => Command[];
}

/** `/help` — list every registered command with its description. */
export function createHelpCommand(deps: HelpCommandDeps): Command {
  return {
    name: 'help',
    description: 'List available slash commands',
    run: () => {
      const cmds = deps.list();
      if (cmds.length === 0) return { ok: true, output: '_No commands registered._' };
      const lines = ['**Commands**', ...cmds.map((c) => `- \`/${c.name}\` — ${c.description}`)];
      return { ok: true, output: lines.join('\n') };
    },
  };
}
