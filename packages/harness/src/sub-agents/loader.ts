import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { HostConfig } from '../host-config';
import { parseSubAgent } from './parser';
import type { SubAgent } from './types';

/**
 * Load every sub-agent from `hostConfig.subAgentsDirs`.
 *
 * v1 behavior: top-level `.md` files only (no recursion). When two sub-agents
 * share a name, the one from the later directory wins — directories are in
 * precedence order. Missing directories are skipped; malformed files throw.
 */
export function loadSubAgents(hostConfig: HostConfig): SubAgent[] {
  const byName = new Map<string, SubAgent>();

  for (const dir of hostConfig.subAgentsDirs) {
    if (!existsSync(dir)) continue;
    if (!statSync(dir).isDirectory()) continue;

    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name) !== '.md') continue;
      const filePath = join(dir, entry.name);
      const source = readFileSync(filePath, 'utf-8');
      const fallbackName = basename(entry.name, '.md');
      const agent = parseSubAgent({ source, filePath, fallbackName });
      byName.set(agent.name, agent);
    }
  }

  return [...byName.values()];
}
