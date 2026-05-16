/**
 * Skill discovery + loading.
 *
 * Discovery scans, in priority order (first match per skill name wins):
 *
 *   1. ~/.config/mu/skills/<name>/SKILL.md     — personal/global
 *   2. <cwd-up-to-git-root>/.mu/skills/<name>/SKILL.md
 *   3. <cwd-up-to-git-root>/.skills/<name>/SKILL.md
 *
 * The cache is populated lazily on first access and can be invalidated via
 * `refresh()` (also exposed through the `/skill:refresh` command).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type ParsedSkill, parseSkillMarkdown } from './parser';

export interface DiscoveredSkill extends ParsedSkill {
  /** Absolute path to SKILL.md. */
  path: string;
  /** Directory containing SKILL.md (the skill root). */
  dir: string;
  /** Scope the skill was loaded from. */
  scope: 'personal' | 'project-mu' | 'project-dot';
}

export interface SkillSourceConfig {
  /** Override personal scope dir. Defaults to `~/.config/mu/skills`. */
  personalDir?: string;
  /** Working directory accessor. Defaults to `process.cwd()`. */
  getCwd?: () => string;
}

function defaultPersonalDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'mu', 'skills');
}

/**
 * Walk up from `start` (inclusive) collecting paths that contain either a
 * `.git` directory or that ARE the filesystem root. Order: closest first.
 */
function walkUpToRoot(start: string): string[] {
  const out: string[] = [];
  let current = resolve(start);
  // Guard against infinite loops on exotic filesystems.
  for (let i = 0; i < 64; i++) {
    out.push(current);
    if (existsSync(join(current, '.git'))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function collectSkillsFromRoot(
  rootDir: string,
  scope: DiscoveredSkill['scope'],
  out: Map<string, DiscoveredSkill>,
): void {
  if (!isDir(rootDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const dir = join(rootDir, entry);
    const skillFile = join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    let raw: string;
    try {
      raw = readFileSync(skillFile, 'utf-8');
    } catch {
      continue;
    }
    const parsed = parseSkillMarkdown(raw, entry);
    if (!parsed) continue;
    // First-write-wins, since we visit scopes in priority order.
    if (out.has(parsed.name)) continue;
    out.set(parsed.name, { ...parsed, path: skillFile, dir, scope });
  }
}

export class SkillRegistry {
  private readonly personalDir: string;
  private readonly getCwd: () => string;
  private cache: Map<string, DiscoveredSkill> | null = null;

  constructor(opts: SkillSourceConfig = {}) {
    this.personalDir = opts.personalDir ?? defaultPersonalDir();
    this.getCwd = opts.getCwd ?? ((): string => process.cwd());
  }

  /** Force a re-scan on the next access. */
  refresh(): void {
    this.cache = null;
  }

  list(): DiscoveredSkill[] {
    return Array.from(this.ensure().values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): DiscoveredSkill | undefined {
    return this.ensure().get(name);
  }

  /** Roots visited during discovery — exposed for diagnostics / commands. */
  describeSources(): string[] {
    const cwd = this.getCwd();
    const lines: string[] = [];
    lines.push(`personal: ${this.personalDir}${isDir(this.personalDir) ? '' : ' (missing)'}`);
    for (const up of walkUpToRoot(cwd)) {
      const mu = join(up, '.mu', 'skills');
      const dot = join(up, '.skills');
      if (isDir(mu)) lines.push(`project-mu: ${mu}`);
      if (isDir(dot)) lines.push(`project-dot: ${dot}`);
    }
    return lines;
  }

  private ensure(): Map<string, DiscoveredSkill> {
    if (this.cache) return this.cache;
    const out = new Map<string, DiscoveredSkill>();

    // 1. Personal.
    collectSkillsFromRoot(this.personalDir, 'personal', out);

    // 2 + 3. Project scopes, walking up from cwd.
    for (const up of walkUpToRoot(this.getCwd())) {
      collectSkillsFromRoot(join(up, '.mu', 'skills'), 'project-mu', out);
      collectSkillsFromRoot(join(up, '.skills'), 'project-dot', out);
    }

    this.cache = out;
    return out;
  }
}
