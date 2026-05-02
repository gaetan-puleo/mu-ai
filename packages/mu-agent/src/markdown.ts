import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDefinition } from './types';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Parse simple `key: value` YAML-style frontmatter — no nested keys, no list
 * syntax. Sufficient for our small definition schema and avoids pulling a
 * full YAML dependency.
 */
function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Load a single agent markdown file. Returns `null` when the file is missing
 * or malformed (no frontmatter). The caller is responsible for layering
 * built-in defaults on top of partial file definitions.
 */
export function loadAgentFile(filePath: string, fallbackName: string): AgentDefinition | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) return null;
  const fm = parseFrontmatter(fmMatch[1]);
  const body = raw.slice(fmMatch[0].length).trim();
  const type = (fm.agent ?? fm.type ?? 'primary').toLowerCase() === 'subagent' ? 'subagent' : 'primary';
  const tools = (fm.tools ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    name: fm.name || fallbackName,
    description: fm.description ?? '',
    tools,
    color: fm.color || undefined,
    systemPrompt: body,
    type,
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
  const overrideMap = new Map<string, AgentDefinition>();
  for (const def of overrides) {
    overrideMap.set(`${def.type}:${def.name}`, def);
  }
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
