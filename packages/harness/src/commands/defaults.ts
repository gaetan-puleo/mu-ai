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

const GRID_COLS = 20;
const GRID_ROWS = 10;
const GRID_CELLS = GRID_COLS * GRID_ROWS;
const GRID_WIDTH = GRID_COLS * 2 - 1; // glyphs joined by single spaces
const USED = '⛁'; // a filled context cell (Claude Code's /context glyph)
const FREEG = '⛶'; // a free cell
// Truecolor SGR — distinct, readable hues (mu's TUI utils + the companion both strip/parse
// these correctly). Secondary text uses a single grey so only the category glyphs carry colour.
const RESET = '\x1b[0m';
const GREY = '\x1b[38;2;153;153;153m';
const BOLD = '\x1b[1m';
const ITALIC = '\x1b[3m';
const BUFFER_COLOR = '\x1b[38;2;255;193;7m'; // amber — the compaction reserve
const paint = (s: string, color: string): string => `${color}${s}${RESET}`;
const fmtTok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const pctStr = (n: number, w: number): string => {
  if (w <= 0) return '';
  const p = (n / w) * 100;
  return p > 0 && p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`;
};

/** Extract a `<tag>…</tag>` block (with tags), or '' when absent. */
function tagBlock(s: string, tag: string): string {
  const i = s.indexOf(`<${tag}>`);
  const j = s.indexOf(`</${tag}>`);
  return i !== -1 && j > i ? s.slice(i, j + `</${tag}>`.length) : '';
}

/** Split the assembled system into its segments: agent prompt / env / instructions / memory / tool-prompts. */
function splitSystem(system: string): {
  agent: string;
  env: string;
  instructions: string;
  memory: string;
  toolPrompts: string;
} {
  const env = tagBlock(system, 'env');
  const instructions = tagBlock(system, 'instructions');
  const memory = tagBlock(system, 'memory');
  const opens = ['<env>', '<instructions>', '<memory>'].map((t) => system.indexOf(t)).filter((i) => i !== -1);
  const closes = (
    [
      [env, '</env>'],
      [instructions, '</instructions>'],
      [memory, '</memory>'],
    ] as const
  )
    .filter(([b]) => b)
    .map(([, c]) => system.indexOf(c) + c.length);
  const firstOpen = opens.length ? Math.min(...opens) : -1;
  const lastClose = closes.length ? Math.max(...closes) : -1;
  return {
    agent: (firstOpen === -1 ? system : system.slice(0, firstOpen)).trim(),
    env,
    instructions,
    memory,
    toolPrompts: lastClose === -1 ? '' : system.slice(lastClose).trim(),
  };
}

/**
 * Universal `/context` — the live session's context broken down into all categories
 * (system / context / instructions / memory / tools / you / agent / tool-output), each
 * counted with the model's own tokenizer, plus the context-window fill % and a colour
 * heatmap. Works on every channel.
 */
export const createContextCommand = (): Command => ({
  name: 'context',
  description: 'Show the live context: per-category tokens, window fill %, and a heatmap',
  run: async (_args, ctx) => {
    const last = await ctx.session?.assembleRequest?.();
    if (!last) return { ok: true, output: 'No session in memory yet — start a conversation first.' };

    const sys = splitSystem(last.system);
    const toolSchemas = last.tools
      .map((t) => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }))
      .join('\n');
    const body = last.messages.filter((m) => m.role !== 'system');
    const byRole = (role: string): string =>
      body.filter((m) => m.role === role).map((m) => JSON.stringify(m.content)).join('\n');

    const count = ctx.session?.countTokens;
    const measure = async (text: string): Promise<{ n: number; exact: boolean }> => {
      if (!text) return { n: 0, exact: true };
      if (count) {
        const n = await count(text);
        if (n !== undefined) return { n, exact: true };
      }
      return { n: estTokens(text.length), exact: false };
    };

    // label, text, truecolor — distinct hues across the wheel, in render order.
    const SPEC: ReadonlyArray<[label: string, text: string, color: string]> = [
      ['System prompt', sys.agent, '\x1b[38;2;239;108;82m'], // coral — the agent prompt
      ['Environment', sys.env, '\x1b[38;2;129;199;132m'], // green — the <env> block
      ['Instructions', sys.instructions, '\x1b[38;2;100;181;246m'], // blue — AGENTS.md / CLAUDE.md
      ['Memory', sys.memory, '\x1b[38;2;186;104;200m'], // purple — MEMORY.md
      ['Tools', `${toolSchemas}\n${sys.toolPrompts}`, '\x1b[38;2;77;182;172m'], // teal — schemas + tool prompts
      ['You', byRole('user'), '\x1b[38;2;121;134;203m'], // indigo — your messages
      ['Agent', byRole('assistant'), '\x1b[38;2;240;98;146m'], // pink — assistant replies
      ['Tool results', byRole('tool'), '\x1b[38;2;0;188;212m'], // cyan — tool results (distinct from amber buffer)
    ];
    const measured = await Promise.all(SPEC.map(([, text]) => measure(text)));
    const cats = SPEC.map(([label, , color], i) => ({ label, n: measured[i].n, color })).filter((c) => c.n > 0);
    const exact = measured.every((m) => m.exact);
    const total = cats.reduce((s, c) => s + c.n, 0);
    const window = (await ctx.session?.contextWindow?.()) ?? 0;
    const buffer = window > 0 ? Math.min(Math.round(window * 0.2), Math.max(0, window - total)) : 0;
    const free = Math.max(0, window - total - buffer);
    const mark = (n: number): string => (exact ? fmtTok(n) : `~${fmtTok(n)}`);
    const model = ctx.session?.model ?? '';

    // Right-hand info column — model, totals, then per-category usage (Claude Code's /context).
    const info: string[] = [];
    if (model) {
      info.push(model.split('/').pop() ?? model);
      info.push(paint(model, GREY));
    }
    if (window > 0) info.push(paint(`${mark(total)}/${fmtTok(window)} tokens (${pctStr(total, window)})`, GREY));
    info.push('');
    info.push(`${ITALIC}${GREY}Estimated usage by category${RESET}`);
    for (const c of cats) {
      info.push(`${paint(USED, c.color)} ${c.label}: ${paint(`${mark(c.n)} tokens (${pctStr(c.n, window)})`, GREY)}`);
    }
    if (window > 0) {
      info.push(`${paint(USED, BUFFER_COLOR)} Compaction buffer: ${paint(`${fmtTok(buffer)} tokens (${pctStr(buffer, window)})`, GREY)}`);
      info.push(`${paint(FREEG, GREY)} Free space: ${paint(`${fmtTok(free)} (${pctStr(free, window)})`, GREY)}`);
    }

    const lines = [`${BOLD}Context Usage${RESET}`];

    if (window > 0) {
      // Grid: category cells, then free, with the compaction buffer at the very end.
      const cellTokens = Math.max(1, window / GRID_CELLS);
      const ratio = (n: number): number => (n <= 0 ? 0 : Math.max(1, Math.round(n / cellTokens)));
      const cells: string[] = [];
      for (const c of cats) for (let i = 0; i < ratio(c.n) && cells.length < GRID_CELLS; i++) cells.push(paint(USED, c.color));
      const bufCells = Math.min(ratio(buffer), Math.max(0, GRID_CELLS - cells.length));
      const freeCells = Math.max(0, GRID_CELLS - cells.length - bufCells);
      for (let i = 0; i < freeCells; i++) cells.push(paint(FREEG, GREY));
      for (let i = 0; i < bufCells; i++) cells.push(paint(USED, BUFFER_COLOR));
      cells.length = GRID_CELLS;

      // Side-by-side: 20×10 grid (space-separated glyphs) on the left, info column on the right.
      for (let r = 0; r < Math.max(GRID_ROWS, info.length); r++) {
        const gridRow = r < GRID_ROWS ? cells.slice(r * GRID_COLS, (r + 1) * GRID_COLS).join(' ') : ' '.repeat(GRID_WIDTH);
        lines.push(`${gridRow}  ${info[r] ?? ''}`.trimEnd());
      }
    } else {
      for (const l of info) lines.push(l.trimEnd());
    }

    return { ok: true, output: lines.join('\n') };
  },
});

/** Universal `/compact` — manually summarize older messages to free context now. */
export const createCompactCommand = (): Command => ({
  name: 'compact',
  description: 'Summarize older messages to free up context now',
  run: async (_args, ctx) => {
    if (!ctx.session?.compact) return { ok: true, output: 'Compaction is not available on this session.' };
    const before = ctx.session.messages?.length ?? 0;
    await ctx.session.compact();
    const after = ctx.session.messages?.length ?? 0;
    return {
      ok: true,
      output: after < before ? `Compacted: ${before} → ${after} messages.` : 'Nothing to compact yet.',
    };
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
