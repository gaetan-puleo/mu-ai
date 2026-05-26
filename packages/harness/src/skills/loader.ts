import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { HostConfig } from '../host-config';
import { parseSkill } from './parser';
import type { Skill } from './types';

/**
 * Load all skills from every directory in `hostConfig.skillsDirs`.
 *
 * v1 behavior: top-level `.md` files only (no recursion). When two skills
 * share a name, the one from the later directory in the list wins —
 * directories are in precedence order.
 *
 * Missing directories are skipped silently. Malformed skill files throw.
 */
export function loadSkills(hostConfig: HostConfig): Skill[] {
  const byName = new Map<string, Skill>();

  for (const dir of hostConfig.skillsDirs) {
    if (!existsSync(dir)) continue;
    const stat = statSync(dir);
    if (!stat.isDirectory()) continue;

    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name) !== '.md') continue;
      const filePath = join(dir, entry.name);
      const source = readFileSync(filePath, 'utf-8');
      const fallbackName = basename(entry.name, '.md');
      const skill = parseSkill({ source, filePath, fallbackName });
      byName.set(skill.name, skill);
    }
  }

  return [...byName.values()];
}
