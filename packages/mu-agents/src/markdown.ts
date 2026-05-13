import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type PermissionMap, parsePermissions } from './permissions';

export interface Agent {
  name: string;
  description: string;
  /** System prompt body (markdown after the frontmatter). */
  prompt: string;
  /** Allowed tool names. `['*']` means all tools. */
  tools: string[];
  /** Optional per-tool, per-arg-glob rules. Takes precedence over `tools`. */
  permissions?: PermissionMap;
  /** Optional display color (host UIs choose how to use it). */
  color?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

interface RawFrontmatter {
  id?: string;
  name?: string;
  description?: string;
  color?: string;
  tools?: unknown;
}

export function loadAgentFile(filePath: string): Agent | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) return null;

  let fm: RawFrontmatter;
  try {
    fm = (parseYaml(fmMatch[1] ?? '') ?? {}) as RawFrontmatter;
  } catch {
    return null;
  }
  if (typeof fm !== 'object' || fm === null) return null;

  const body = raw.slice(fmMatch[0].length).trim();
  const fallbackName = basename(filePath, extname(filePath));
  const name = fm.id ?? fm.name ?? fallbackName;
  const { permissions, allowList } = parsePermissions(fm.tools);

  return {
    name,
    description: fm.description ?? '',
    prompt: body,
    tools: allowList,
    permissions,
    color: fm.color,
  };
}

export function loadAgentsFromDir(dir: string): Agent[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: Agent[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const agent = loadAgentFile(join(dir, file));
    if (agent) out.push(agent);
  }
  return out;
}
