import type { AgentRegistry } from '../agents';
import type { SessionManager } from '../session';
import type { SkillRegistry } from '../skills';
import type { Command } from './types';

export const createAgentsCommand = (agents: AgentRegistry): Command => ({
  name: 'agents',
  description: 'List available agents',
  run: () => {
    const list = agents.list();
    if (list.length === 0) return { ok: true, output: 'No agents configured.' };
    const lines = list.map((a) => `- ${a.name}${a.description ? ` — ${a.description}` : ''}`);
    return { ok: true, output: lines.join('\n') };
  },
});

export const createSkillsCommand = (skills: SkillRegistry): Command => ({
  name: 'skills',
  description: 'List available skills',
  run: () => {
    const list = skills.list();
    if (list.length === 0) return { ok: true, output: 'No skills configured.' };
    const lines = list.map((s) => `- ${s.name}${s.description ? ` — ${s.description}` : ''}`);
    return { ok: true, output: lines.join('\n') };
  },
});

export const createSessionsCommand = (sessions: SessionManager): Command => ({
  name: 'sessions',
  description: 'List saved sessions',
  run: async () => {
    const list = await sessions.list();
    if (list.length === 0) return { ok: true, output: 'No sessions yet.' };
    const lines = list.map((s) => `- ${s.title || s.id}`);
    return { ok: true, output: lines.join('\n') };
  },
});

export const createQuitCommand = (onQuit: () => void | Promise<void>): Command => ({
  name: 'quit',
  description: 'Exit the session',
  aliases: ['q'],
  run: async () => {
    await onQuit();
    return { ok: true };
  },
});

export const createHelpCommand = (list: () => Command[]): Command => ({
  name: 'help',
  description: 'Show available commands',
  run: () => {
    const commands = list();
    if (commands.length === 0) return { ok: true, output: 'No commands registered.' };
    const lines = commands.map((c) => `/${c.name} — ${c.description}`);
    return { ok: true, output: lines.join('\n') };
  },
});
