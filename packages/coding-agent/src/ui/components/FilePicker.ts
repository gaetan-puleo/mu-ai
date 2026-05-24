import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Component, EventContext, InputEvent, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

export interface FilePickerEntry {
  path: string;
  isDir: boolean;
}

export interface FilePickerProps {
  cwd: string;
  query: string;
  selectedIndex?: number;
  onSelect?: (entry: FilePickerEntry) => void;
  layout?: LayoutStyle;
}

const RESET = '\x1b[0m';
const DESCRIPTION = '\x1b[2m';
const MAX_VISIBLE = 8;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 5000;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target',
  '.deno', 'coverage', '.cache',
]);

function walkTree(root: string, prefix: string, depth: number, result: FilePickerEntry[]): void {
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
let cachedTree: FilePickerEntry[] = [];

export function getProjectTree(cwd: string): FilePickerEntry[] {
  if (cachedCwd === cwd && cachedTree.length > 0) return cachedTree;
  cachedCwd = cwd;
  cachedTree = [];
  walkTree(cwd, '', 0, cachedTree);
  return cachedTree;
}

export function invalidateTreeCache(): void {
  cachedCwd = '';
  cachedTree = [];
}

function fuzzyScore(path: string, query: string): number {
  const lower = path.toLowerCase();
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
  score -= path.length * 0.01;
  return score;
}

export function fuzzyFilter(entries: FilePickerEntry[], query: string): FilePickerEntry[] {
  if (!query) return entries.slice(0, 50);
  const scored = [];
  for (const entry of entries) {
    const s = fuzzyScore(entry.path, query);
    if (s >= 0) scored.push({ entry, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50).map((s) => s.entry);
}

export class FilePicker implements Component {
  layout: LayoutStyle;
  private entries: FilePickerEntry[];
  private selectedIndex: number;
  private hoveredIndex = -1;
  private readonly onSelect?: (entry: FilePickerEntry) => void;

  constructor(props: FilePickerProps) {
    const tree = getProjectTree(props.cwd);
    this.entries = fuzzyFilter(tree, props.query);
    this.selectedIndex = props.selectedIndex ?? 0;
    this.onSelect = props.onSelect;
    const visible = Math.min(MAX_VISIBLE, Math.max(1, this.entries.length));
    this.layout = { width: 'fill', height: visible, ...props.layout };
  }

  get visibleEntries(): FilePickerEntry[] {
    return this.entries;
  }

  get selected(): FilePickerEntry | undefined {
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
      const prefix = selected ? '› ' : '  ';
      const name = entry.isDir ? `${entry.path}/` : entry.path;
      const plain = `${prefix}${name}`;
      const padding = Math.max(0, width - visibleWidth(plain));
      const fitted = visibleWidth(plain) > width
        ? `${prefix}${truncateToWidth(name, width - 2)}`
        : `${plain}${' '.repeat(padding)}`;
      const style = selected ? selectedSgr : hovered ? hoverSgr : normalSgr;
      return style ? `${style}${fitted}${RESET}` : fitted;
    });
  }
}
