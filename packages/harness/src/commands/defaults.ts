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
const BLOCK = '█';
const FREE = '·';
const BUFFER_COLOR = '\x1b[93m'; // bright yellow — the compaction reserve
// ANSI SGR colours — mu's TUI text utils are ANSI-aware so these render in the terminal;
// the companion strips them (plain text), keeping the labelled breakdown readable.
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const paint = (s: string, color: string): string => `${color}${s}${RESET}`;
const fmtTok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const pctStr = (n: number, w: number): string => {
  if (w <= 0) return '';
  const p = (n / w) * 100;
  return p > 0 && p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`;
};
const fillColor = (pct: number): string => (pct >= 80 ? '\x1b[31m' : pct >= 50 ? '\x1b[33m' : '\x1b[32m');

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

    // label, text, ANSI colour — one per category, in render order.
    const SPEC: ReadonlyArray<[label: string, text: string, color: string]> = [
      ['system', sys.agent, '\x1b[36m'], // cyan — the agent prompt
      ['context', sys.env, '\x1b[33m'], // yellow — the <env> block
      ['instructions', sys.instructions, '\x1b[34m'], // blue — AGENTS.md / CLAUDE.md
      ['memory', sys.memory, '\x1b[35m'], // magenta — MEMORY.md
      ['tools', `${toolSchemas}\n${sys.toolPrompts}`, '\x1b[31m'], // red — schemas + tool prompts
      ['you', byRole('user'), '\x1b[32m'], // green — your messages
      ['agent', byRole('assistant'), '\x1b[94m'], // bright blue — assistant replies
      ['tool-out', byRole('tool'), '\x1b[90m'], // grey — tool results
    ];
    const measured = await Promise.all(SPEC.map(([, text]) => measure(text)));
    const cats = SPEC.map(([label, , color], i) => ({ label, n: measured[i].n, color })).filter((c) => c.n > 0);
    const exact = measured.every((m) => m.exact);
    const total = cats.reduce((s, c) => s + c.n, 0);
    const window = (await ctx.session?.contextWindow?.()) ?? 0;
    const buffer = window > 0 ? Math.min(Math.round(window * 0.2), Math.max(0, window - total)) : 0;
    const free = Math.max(0, window - total - buffer);
    const mark = (n: number): string => (exact ? fmtTok(n) : `~${fmtTok(n)}`);
    const pctNum = window ? Math.round((total / window) * 100) : 0;

    // Legend rows (categories, then buffer + free), Claude Code / oh-my-pi style.
    const rows = cats.map((c) => ({ marker: paint(BLOCK, c.color), label: c.label, n: c.n }));
    if (window > 0) {
      rows.push({ marker: paint(BLOCK, BUFFER_COLOR), label: 'buffer', n: buffer });
      rows.push({ marker: paint(FREE, DIM), label: 'free', n: free });
    }
    const legend = rows.map((r) => `${r.marker} ${r.label.padEnd(13)} ${mark(r.n).padStart(7)}  ${pctStr(r.n, window).padStart(6)}`);

    const header = window
      ? `context · ${mark(total)} / ${fmtTok(window)} ${paint(`(${pctStr(total, window)})`, fillColor(pctNum))}`
      : `context · ${mark(total)} tokens (no model context window)`;
    const lines = [header, ''];

    if (window > 0) {
      // Build the grid: category cells, then free, with the compaction buffer at the very end.
      const cellTokens = Math.max(1, window / GRID_CELLS);
      const ratio = (n: number): number => (n <= 0 ? 0 : Math.max(1, Math.round(n / cellTokens)));
      const cells: string[] = [];
      for (const c of cats) for (let i = 0; i < ratio(c.n) && cells.length < GRID_CELLS; i++) cells.push(paint(BLOCK, c.color));
      const bufCells = Math.min(ratio(buffer), Math.max(0, GRID_CELLS - cells.length));
      const freeCells = Math.max(0, GRID_CELLS - cells.length - bufCells);
      for (let i = 0; i < freeCells; i++) cells.push(paint(FREE, DIM));
      for (let i = 0; i < bufCells; i++) cells.push(paint(BLOCK, BUFFER_COLOR));
      cells.length = GRID_CELLS;

      // Side-by-side: 20×10 grid on the left, the legend on the right.
      const rowsCount = Math.max(GRID_ROWS, legend.length);
      for (let r = 0; r < rowsCount; r++) {
        const gridRow = r < GRID_ROWS ? cells.slice(r * GRID_COLS, (r + 1) * GRID_COLS).join('') : ' '.repeat(GRID_COLS);
        lines.push(`  ${gridRow}  ${legend[r] ?? ''}`.trimEnd());
      }
    } else {
      for (const l of legend) lines.push(`  ${l.trimEnd()}`);
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
