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
  description: 'Show the exact context for the current session (real system, tools, token count)',
  run: async (_args, ctx) => {
    const last = await ctx.session?.assembleRequest?.();
    if (!last) return { ok: true, output: 'No session in memory yet — start a conversation first.' };

    const systemText = last.system;
    const toolsText = last.tools
      .map((t) => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }) + (t.prompt ?? ''))
      .join('\n');
    const body = last.messages.filter((m) => m.role !== 'system');
    const messagesText = body.map((m) => JSON.stringify(m.content)).join('\n');

    // Prefer the model's own tokenizer (llama.cpp /tokenize); fall back to a chars/4 estimate.
    const count = ctx.session?.countTokens;
    const [rSys, rTools, rMsgs] = count
      ? await Promise.all([count(systemText), count(toolsText), count(messagesText)])
      : [undefined, undefined, undefined];
    const exact = rSys !== undefined && rTools !== undefined && rMsgs !== undefined;
    const sys = rSys ?? estTokens(systemText.length);
    const tools = rTools ?? estTokens(toolsText.length);
    const msgs = rMsgs ?? estTokens(messagesText.length);
    const mark = (n: number): string => (exact ? `${n}` : `~${n}`);

    const toolNames = last.tools.map((t) => t.name).join(', ') || '(none)';
    const output = [
      `context — tokens (${exact ? 'exact, model tokenizer' : 'estimated ≈ chars/4'}):`,
      `  system    ${mark(sys)}`,
      `  tools     ${mark(tools)}  (${last.tools.length}: ${toolNames})`,
      `  messages  ${mark(msgs)}  (${body.length})`,
      `  ── total  ${mark(sys + tools + msgs)}`,
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
