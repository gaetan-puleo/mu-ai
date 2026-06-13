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

export const createSessionsCommand = (sessions: SessionManager, options?: { cwd?: string }): Command => ({
  name: 'sessions',
  description: 'List saved sessions',
  run: async () => {
    const list = await sessions.list(options?.cwd ? { cwd: options.cwd } : undefined);
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

const estTokens = (chars: number): number => Math.max(1, Math.round(chars / 4));

/**
 * Universal `/context` — shows the EXACT request the model saw on the last turn
 * (real assembled system incl. env + tool prompt blocks, the post-hook tool set, and
 * an estimated per-component token breakdown). Works on any channel that injects the
 * live session into the command context.
 */
export const createContextCommand = (): Command => ({
  name: 'context',
  description: 'Show the exact context for the current session (real system, tools, token estimate)',
  run: async (_args, ctx) => {
    const last = await ctx.session?.assembleRequest?.();
    if (!last) return { ok: true, output: 'No session in memory yet — start a conversation first.' };
    const sysChars = last.system.length;
    const toolsChars = last.tools.reduce(
      (n, t) =>
        n + JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length +
        (t.prompt?.length ?? 0),
      0,
    );
    const body = last.messages.filter((m) => m.role !== 'system');
    const msgChars = body.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
    const sysTok = estTokens(sysChars);
    const toolsTok = estTokens(toolsChars);
    const msgTok = estTokens(msgChars);
    const toolNames = last.tools.map((t) => t.name).join(', ') || '(none)';
    const output = [
      'context sent to the model — estimated tokens (≈ chars/4):',
      `  system    ~${sysTok}  (${sysChars} chars)`,
      `  tools     ~${toolsTok}  (${last.tools.length}: ${toolNames})`,
      `  messages  ~${msgTok}  (${body.length})`,
      `  ── total  ~${sysTok + toolsTok + msgTok}`,
      '',
      '── system prompt (exact) ──',
      last.system,
    ].join('\n');
    return { ok: true, output };
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
