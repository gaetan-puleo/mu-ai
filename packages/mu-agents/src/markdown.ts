import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Action, PermissionMap, ToolPermission } from './permissions';
import type { AgentDefinition } from './types';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

interface RawFrontmatter {
  id?: string;
  name?: string;
  description?: string;
  agent?: string;
  type?: string;
  model?: string;
  enabled?: boolean;
  color?: string;
  tools?: unknown;
}

function isAction(v: unknown): v is Action {
  return v === 'allow' || v === 'deny' || v === 'ask';
}

function normaliseToolPermission(raw: unknown): ToolPermission | null {
  if (isAction(raw)) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, Action> = {};
    for (const [glob, action] of Object.entries(raw as Record<string, unknown>)) {
      if (isAction(action)) out[glob] = action;
    }
    return out;
  }
  return null;
}

/**
 * Parse the new structured `tools:` map. Returns:
 *   { permissions: PermissionMap, allowList: string[] }
 *
 * `allowList` mirrors the legacy `tools` array: tool names whose rule is
 * not a literal `'deny'`. The legacy comma-list `tools: a, b` form is
 * accepted as a fallback (no permission map produced).
 */
function parseTools(raw: unknown): { permissions: PermissionMap | undefined; allowList: string[] } {
  if (raw === undefined || raw === null) return { permissions: undefined, allowList: ['*'] };

  if (typeof raw === 'string') {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { permissions: undefined, allowList: list };
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const permissions: PermissionMap = {};
    const allowList: string[] = [];
    for (const [tool, rule] of Object.entries(raw as Record<string, unknown>)) {
      const norm = normaliseToolPermission(rule);
      if (norm === null) continue;
      permissions[tool] = norm;
      if (norm !== 'deny') allowList.push(tool);
    }
    return { permissions, allowList };
  }

  if (Array.isArray(raw)) {
    return { permissions: undefined, allowList: raw.map(String).filter(Boolean) };
  }

  return { permissions: undefined, allowList: ['*'] };
}

/**
 * Load a single agent markdown file. Returns `null` when the file is missing
 * or malformed (no frontmatter). Tolerant of both the legacy schema (`name`,
 * `tools: a, b`) and the new one (`id`, `tools:` as a map).
 */
export function loadAgentFile(filePath: string, fallbackName: string): AgentDefinition | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) return null;
  let fm: RawFrontmatter;
  try {
    fm = (parseYaml(fmMatch[1]) ?? {}) as RawFrontmatter;
  } catch {
    return null;
  }
  if (typeof fm !== 'object' || fm === null) return null;
  const body = raw.slice(fmMatch[0].length).trim();
  const type = String(fm.agent ?? fm.type ?? 'primary').toLowerCase() === 'subagent' ? 'subagent' : 'primary';
  const { permissions, allowList } = parseTools(fm.tools);
  const id = fm.id ?? fm.name ?? fallbackName;
  return {
    name: id,
    description: fm.description ?? '',
    tools: allowList,
    permissions,
    color: fm.color || undefined,
    systemPrompt: body,
    type,
    model: fm.model,
    enabled: fm.enabled ?? true,
  };
}

/**
 * Load every `*.md` file in `dir` as an agent definition. Files that fail
 * to parse are silently skipped — that way one bad file doesn't disable the
 * whole plugin. Returns the list in directory order.
 */
export function loadAgentsFromDir(dir: string): AgentDefinition[] {
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: AgentDefinition[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const def = loadAgentFile(path, file.replace(/\.md$/, ''));
    if (def) out.push(def);
  }
  return out;
}

/**
 * Layer markdown overrides on top of built-in defaults. Markdown files take
 * precedence by name; remaining defaults flow through. Result is split by
 * type so callers can iterate primary / subagent separately.
 */
export function mergeAgents(
  defaults: AgentDefinition[],
  overrides: AgentDefinition[],
): { primary: AgentDefinition[]; subagent: AgentDefinition[] } {
  const primary: AgentDefinition[] = [];
  const subagent: AgentDefinition[] = [];
  const claimed = new Set<string>();

  for (const def of overrides) {
    claimed.add(`${def.type}:${def.name}`);
    if (def.type === 'primary') primary.push(def);
    else subagent.push(def);
  }
  for (const def of defaults) {
    const key = `${def.type}:${def.name}`;
    if (claimed.has(key)) continue;
    if (def.type === 'primary') primary.push(def);
    else subagent.push(def);
  }
  return { primary, subagent };
}
