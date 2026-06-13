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

const GRID_COLS = 24;
const GRID_ROWS = 8;
const GRID_CELLS = GRID_COLS * GRID_ROWS;
const GLYPH = { system: '█', context: '▓', tools: '▒', messages: '░', free: '·' } as const;
// ANSI SGR colours — mu's TUI text utils are ANSI-aware so these render in the terminal;
// the companion strips them (plain text). Keep them paired with a reset.
const RESET = '\x1b[0m';
const COLOR = { system: '\x1b[36m', context: '\x1b[33m', tools: '\x1b[35m', messages: '\x1b[32m', free: '\x1b[2m' } as const;
const paint = (s: string, color: string): string => `${color}${s}${RESET}`;
const fillColor = (pct: number): string => (pct >= 80 ? '\x1b[31m' : pct >= 50 ? '\x1b[33m' : '\x1b[32m');

/** Split mu's concatenated effectiveSystem (agent prompt + <env> block + tool-prompt block). */
function splitSystem(system: string): { agent: string; env: string; toolPrompts: string } {
  const start = system.indexOf('<env>');
  const end = system.indexOf('</env>');
  if (start === -1 || end <= start) return { agent: system.trim(), env: '', toolPrompts: '' };
  return {
    agent: system.slice(0, start).trim(),
    env: system.slice(start, end + '</env>'.length),
    toolPrompts: system.slice(end + '</env>'.length).trim(),
  };
}

/**
 * Universal `/context` — shows the EXACT context of the live session: real per-category
 * token counts (system / context / tools / messages, via the model's own tokenizer),
 * the context-window fill %, and a heatmap grid. Works on any channel.
 */
export const createContextCommand = (): Command => ({
  name: 'context',
  description: 'Show the live context: per-category tokens, window fill %, and a heatmap',
  run: async (_args, ctx) => {
    const last = await ctx.session?.assembleRequest?.();
    if (!last) return { ok: true, output: 'No session in memory yet — start a conversation first.' };

    const { agent, env, toolPrompts } = splitSystem(last.system);
    const toolSchemas = last.tools
      .map((t) => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }))
      .join('\n');
    const body = last.messages.filter((m) => m.role !== 'system');
    const messagesText = body.map((m) => JSON.stringify(m.content)).join('\n');

    // Prefer the model's own tokenizer (llama.cpp /tokenize); fall back to chars/4.
    const count = ctx.session?.countTokens;
    const measure = async (text: string): Promise<{ n: number; exact: boolean }> => {
      if (!text) return { n: 0, exact: true };
      if (count) {
        const n = await count(text);
        if (n !== undefined) return { n, exact: true };
      }
      return { n: estTokens(text.length), exact: false };
    };
    const [mSys, mCtx, mTools, mMsgs] = await Promise.all([
      measure(agent),
      measure(env),
      measure(`${toolSchemas}\n${toolPrompts}`),
      measure(messagesText),
    ]);
    const exact = [mSys, mCtx, mTools, mMsgs].every((m) => m.exact);
    const cats = [
      { label: 'system', n: mSys.n, glyph: GLYPH.system, color: COLOR.system },
      { label: 'context', n: mCtx.n, glyph: GLYPH.context, color: COLOR.context },
      { label: 'tools', n: mTools.n, glyph: GLYPH.tools, color: COLOR.tools },
      { label: 'messages', n: mMsgs.n, glyph: GLYPH.messages, color: COLOR.messages },
    ];
    const total = cats.reduce((s, c) => s + c.n, 0);
    const window = (await ctx.session?.contextWindow?.()) ?? 0;
    const mark = (n: number): string => (exact ? `${n}` : `~${n}`);

    const lines = [`context — tokens (${exact ? 'exact, model tokenizer' : 'estimated ≈ chars/4'}):`];
    for (const c of cats) {
      if (c.label === 'context' && c.n === 0) continue;
      const extra = c.label === 'tools'
        ? `  (${last.tools.length})`
        : c.label === 'messages'
        ? `  (${body.length})`
        : '';
      lines.push(`  ${paint(c.glyph, c.color)} ${c.label.padEnd(8)} ${mark(c.n)}${extra}`);
    }
    const pctNum = window ? Math.round((total / window) * 100) : 0;
    const pct = window ? ` / ${window} ${paint(`(${pctNum}%)`, fillColor(pctNum))}` : '';
    lines.push(`  ── total   ${mark(total)}${pct}`);

    // Heatmap grid (each cell ≈ window/GRID_CELLS tokens).
    if (window > 0) {
      const cellTokens = Math.max(1, window / GRID_CELLS);
      const cells: string[] = [];
      for (const c of cats) {
        for (let i = 0; i < Math.round(c.n / cellTokens) && cells.length < GRID_CELLS; i++) cells.push(paint(c.glyph, c.color));
      }
      while (cells.length < GRID_CELLS) cells.push(paint(GLYPH.free, COLOR.free));
      cells.length = GRID_CELLS;
      lines.push('');
      lines.push(
        `  ${paint(GLYPH.system, COLOR.system)} system  ${paint(GLYPH.context, COLOR.context)} context  ` +
          `${paint(GLYPH.tools, COLOR.tools)} tools  ${paint(GLYPH.messages, COLOR.messages)} messages  ` +
          `${paint(GLYPH.free, COLOR.free)} free`,
      );
      for (let r = 0; r < GRID_ROWS; r++) lines.push(`  ${cells.slice(r * GRID_COLS, (r + 1) * GRID_COLS).join('')}`);
    }

    return { ok: true, output: lines.join('\n') };
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
