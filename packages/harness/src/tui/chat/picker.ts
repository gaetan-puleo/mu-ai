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

let cache: { cwd: string; files: string[] } | undefined;

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
  if (!cache || cache.cwd !== cwd) cache = { cwd, files: walk(cwd) };
  const agents: Candidate[] = agentNames.map((name) => ({ label: `@${name}`, insert: name, kind: 'agent' }));
  const files: Candidate[] = cache.files.map((path) => ({ label: path, insert: path, kind: 'file' }));
  return [...agents, ...files];
}

export function invalidateCandidates(): void {
  cache = undefined;
}

function score(query: string, target: string): number | undefined {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let total = 0;
  let prev = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      let s = 1;
      if (i === prev + 1) s += 2;
      if (i === 0 || /[/_\-. ]/.test(t[i - 1] ?? '')) s += 3;
      total += s;
      prev = i;
      qi += 1;
    }
  }
  if (qi < q.length) return undefined;
  return total - t.length * 0.01;
}

export function rank(query: string, candidates: Candidate[], limit = 8): Candidate[] {
  if (!query) return candidates.slice(0, limit);
  const scored: { candidate: Candidate; score: number }[] = [];
  for (const candidate of candidates) {
    const s = score(query, candidate.label);
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
