import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Candidate {
  label: string;
  insert: string;
  kind: 'file' | 'agent';
}

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'target',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'npm',
  'vendor',
]);

const MAX_ENTRIES = 5000;
const MAX_DEPTH = 6;

function gitFiles(cwd: string): string[] | undefined {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out.split('\0').filter((f) => f.length > 0);
    return files.length > 0 ? files.slice(0, MAX_ENTRIES).sort() : undefined;
  } catch {
    return undefined;
  }
}

function walk(cwd: string): string[] {
  const out: string[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir: cwd, depth: 0 }];
  while (stack.length > 0 && out.length < MAX_ENTRIES) {
    const { dir, depth } = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith('.') && name !== '.mu') continue;
      if (IGNORED.has(name)) continue;
      const full = join(dir, name);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (depth < MAX_DEPTH) stack.push({ dir: full, depth: depth + 1 });
      } else {
        out.push(relative(cwd, full));
        if (out.length >= MAX_ENTRIES) break;
      }
    }
  }
  return out.sort();
}

export function collectCandidates(cwd: string, agentNames: string[]): Candidate[] {
  const paths = gitFiles(cwd) ?? walk(cwd);
  const agents: Candidate[] = agentNames.map((name) => ({ label: `@${name}`, insert: name, kind: 'agent' }));
  const files: Candidate[] = paths.map((path) => ({ label: path, insert: path, kind: 'file' }));
  return [...agents, ...files];
}

function isBoundary(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1] ?? '';
  if (/[/\\_\-. ]/.test(prev)) return true;
  const cur = target[i] ?? '';
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur === cur.toUpperCase() &&
    cur !== cur.toLowerCase();
}

function fuzzyScore(query: string, target: string): number | undefined {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  let qi = 0;
  let total = 0;
  let prev = -2;
  let run = 0;
  for (let i = 0; i < target.length && qi < q.length; i++) {
    if (target[i].toLowerCase() === q[qi]) {
      let s = 1;
      if (i === prev + 1) {
        run += 1;
        s += 2 + run;
      } else {
        run = 0;
      }
      if (isBoundary(target, i)) s += 4;
      total += s;
      prev = i;
      qi += 1;
    }
  }
  if (qi < q.length) return undefined;
  return total;
}

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

function score(query: string, candidate: Candidate): number | undefined {
  if (query.length === 0) return 0;
  const pathScore = fuzzyScore(query, candidate.label);
  if (pathScore === undefined) return undefined;
  let total = pathScore;
  if (candidate.kind === 'file') {
    const base = basename(candidate.label);
    const baseScore = fuzzyScore(query, base);
    if (baseScore !== undefined) {
      total += baseScore * 2;
      const lb = base.toLowerCase();
      const lq = query.toLowerCase();
      if (lb === lq) total += 100;
      else if (lb.startsWith(lq)) total += 40;
    }
  }
  return total - candidate.label.length * 0.05;
}

export function rank(query: string, candidates: Candidate[], limit = 8): Candidate[] {
  if (!query) return candidates.slice(0, limit);
  const scored: { candidate: Candidate; score: number }[] = [];
  for (const candidate of candidates) {
    const s = score(query, candidate);
    if (s !== undefined) scored.push({ candidate, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

export interface ActiveMention {
  start: number;
  query: string;
}

export function activeMention(value: string, cursor: number): ActiveMention | undefined {
  let start = -1;
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '@') {
      start = i;
      break;
    }
    if (ch === ' ' || ch === '\n' || ch === '\t') break;
  }
  if (start === -1) return undefined;
  if (start > 0 && !/\s/.test(value[start - 1] ?? ' ')) return undefined;
  return { start, query: value.slice(start + 1, cursor) };
}
