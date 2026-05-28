/**
 * Default slash-command factories shared by harness hosts.
 *
 *   /agents    — list every sub-agent (name + description)
 *   /sessions  — list / inspect persisted sessions
 *   /help      — list every registered command
 *
 * Each factory builds a `Command<unknown>` so it slots into any host's
 * registry. The returned commands serialise their output as a string so a
 * server (arya WS) can forward it to clients without re-rendering.
 */
import type { SessionStore } from 'mu-core';
import type { Command } from './registry';
import type { SubAgent } from '../sub-agents/types';

export function createAgentsCommand(opts: { getSubAgents: () => SubAgent[] }): Command<unknown> {
  return {
    name: 'agents',
    description: 'List available sub-agents',
    run: () => {
      const agents = opts.getSubAgents();
      if (agents.length === 0) return { ok: true, output: 'No sub-agents loaded.' };
      const lines = agents.map((a) => `  ${a.name} — ${a.description}`);
      return { ok: true, output: `Sub-agents:\n${lines.join('\n')}` };
    },
  };
}

export function createSessionsCommand(opts: { store: SessionStore }): Command<unknown> {
  return {
    name: 'sessions',
    description: 'List persisted sessions',
    run: () => {
      const sessions = opts.store.list();
      if (sessions.length === 0) return { ok: true, output: 'No sessions.' };
      const lines = sessions.map((s) => `  ${s.id} — ${s.title ?? '(untitled)'} (${s.messages.length} msgs)`);
      return { ok: true, output: `Sessions:\n${lines.join('\n')}` };
    },
  };
}

export function createHelpCommand(opts: { list: () => Command<unknown>[] }): Command<unknown> {
  return {
    name: 'help',
    description: 'List slash commands',
    run: () => {
      const commands = opts.list();
      const lines = commands.map((c) => `  /${c.name} — ${c.description}`);
      return { ok: true, output: `Commands:\n${lines.join('\n')}` };
    },
  };
}
