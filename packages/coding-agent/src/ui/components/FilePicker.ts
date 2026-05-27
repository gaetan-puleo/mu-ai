import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Component, EventContext, InputEvent, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

export interface AgentPickerInfo {
  name: string;
  description?: string;
  color?: string;
}

/** A row in the dropdown — either an agent mention or a file path. */
export type PickerEntry =
  | { kind: 'agent'; name: string; description?: string; color?: string }
  | { kind: 'file'; path: string; isDir: boolean };

export interface FilePickerProps {
  cwd: string;
  query: string;
  /** Optional list of agents shown above the file matches. */
  agents?: AgentPickerInfo[];
  selectedIndex?: number;
  onSelect?: (entry: PickerEntry) => void;
  layout?: LayoutStyle;
}

const RESET = '\x1b[0m';
const MAX_VISIBLE = 8;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 5000;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target',
  '.deno', 'coverage', '.cache',
]);

function walkTree(root: string, prefix: string, depth: number, result: Array<{ path: string; isDir: boolean }>): void {
  if (depth > MAX_DEPTH || result.length >= MAX_ENTRIES) return;
  let entries;
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (result.length >= MAX_ENTRIES) return;
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      result.push({ path: rel, isDir: true });
      walkTree(root, rel, depth + 1, result);
    } else {
      result.push({ path: rel, isDir: false });
    }
  }
}

let cachedCwd = '';
let cachedTree: Array<{ path: string; isDir: boolean }> = [];

function getProjectTree(cwd: string): Array<{ path: string; isDir: boolean }> {
  if (cachedCwd === cwd && cachedTree.length > 0) return cachedTree;
  cachedCwd = cwd;
  cachedTree = [];
  walkTree(cwd, '', 0, cachedTree);
  return cachedTree;
}

function fuzzyScore(text: string, query: string): number {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  let j = 0;
  let prevMatch = -1;
  for (let i = 0; i < lower.length && j < q.length; i++) {
    if (lower[i] === q[j]) {
      score += 1;
      if (prevMatch === i - 1) score += 3;
      if (i === 0 || lower[i - 1] === '/') score += 2;
      prevMatch = i;
      j++;
    }
  }
  if (j < q.length) return -1;
  score -= text.length * 0.01;
  return score;
}

function fuzzyFilterFiles(entries: Array<{ path: string; isDir: boolean }>, query: string, limit: number) {
  if (!query) return entries.slice(0, limit);
  const scored: Array<{ entry: { path: string; isDir: boolean }; score: number }> = [];
  for (const entry of entries) {
    const s = fuzzyScore(entry.path, query);
    if (s >= 0) scored.push({ entry, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

function fuzzyFilterAgents(agents: AgentPickerInfo[], query: string) {
  if (!query) return agents;
  const scored: Array<{ entry: AgentPickerInfo; score: number }> = [];
  for (const a of agents) {
    const s = fuzzyScore(a.name, query);
    if (s >= 0) scored.push({ entry: a, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

export class FilePicker implements Component {
  layout: LayoutStyle;
  private entries: PickerEntry[];
  private selectedIndex: number;
  private hoveredIndex = -1;
  private readonly onSelect?: (entry: PickerEntry) => void;

  constructor(props: FilePickerProps) {
    const agents = props.agents ? fuzzyFilterAgents(props.agents, props.query) : [];
    const fileBudget = Math.max(0, 50 - agents.length);
    const tree = getProjectTree(props.cwd);
    const files = fuzzyFilterFiles(tree, props.query, fileBudget);

    this.entries = [
      ...agents.map((a): PickerEntry => ({ kind: 'agent', name: a.name, description: a.description, color: a.color })),
      ...files.map((f): PickerEntry => ({ kind: 'file', path: f.path, isDir: f.isDir })),
    ];
    this.selectedIndex = props.selectedIndex ?? 0;
    this.onSelect = props.onSelect;
    const visible = Math.min(MAX_VISIBLE, Math.max(1, this.entries.length));
    this.layout = { width: 'fill', height: visible, ...props.layout };
  }

  get visibleEntries(): PickerEntry[] {
    return this.entries;
  }

  get selected(): PickerEntry | undefined {
    return this.entries[this.selectedIndex];
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, Math.max(0, this.entries.length - 1)));
  }

  handleEvent(event: InputEvent, ctx: EventContext): void {
    if (event.type !== 'mouse') return;
    const y = ctx.localY ?? 0;
    if (y < 0 || y >= Math.min(MAX_VISIBLE, this.entries.length)) {
      if (event.kind === 'move') this.hoveredIndex = -1;
      return;
    }
    if (event.kind === 'move' || event.kind === 'drag') {
      this.hoveredIndex = y;
      return;
    }
    if (event.kind === 'press' && event.button === 'left') {
      this.selectedIndex = y;
      this.hoveredIndex = y;
      const entry = this.entries[y];
      if (entry) this.onSelect?.(entry);
    }
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const selectedSgr = styleToAnsi(theme.styles.commandPaletteSelected);
    const hoverSgr = styleToAnsi(theme.styles.commandPaletteHover);
    const normalSgr = styleToAnsi(theme.styles.commandPaletteItem);
    const dimSgr = styleToAnsi({ fg: theme.colors.textMuted });

    const visibleCount = Math.min(height, this.entries.length);
    let startIndex = 0;
    if (this.selectedIndex >= startIndex + visibleCount) {
      startIndex = this.selectedIndex - visibleCount + 1;
    }
    if (this.selectedIndex < startIndex) {
      startIndex = this.selectedIndex;
    }

    return this.entries.slice(startIndex, startIndex + visibleCount).map((entry, i) => {
      const entryIndex = startIndex + i;
      const selected = entryIndex === this.selectedIndex;
      const hovered = entryIndex === this.hoveredIndex;
      const rowStyle = selected ? selectedSgr : hovered ? hoverSgr : normalSgr;
      const prefix = selected ? '› ' : '  ';

      // Build plain text (for width math) and styled text (for output) in parallel.
      // After every inline color override we re-emit `rowStyle` so the row's
      // background and base foreground keep applying to the rest of the line.
      let plainBody: string;
      let styledBody: string;
      if (entry.kind === 'agent') {
        const labelText = `@${entry.name}`;
        plainBody = entry.description ? `${labelText}  ${entry.description}` : labelText;
        styledBody = plainBody;
      } else {
        const text = entry.isDir ? `${entry.path}/` : entry.path;
        plainBody = text;
        styledBody = text;
      }

      const plain = `${prefix}${plainBody}`;
      if (visibleWidth(plain) > width) {
        const truncated = truncateToWidth(plainBody, Math.max(0, width - visibleWidth(prefix)));
        const out = `${rowStyle}${prefix}${truncated}${RESET}`;
        return out;
      }
      const padding = ' '.repeat(Math.max(0, width - visibleWidth(plain)));
      return `${rowStyle}${prefix}${styledBody}${rowStyle}${padding}${RESET}`;
    });
  }
}
