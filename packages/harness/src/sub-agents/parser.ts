import { parseFrontmatter } from '../markdown';
import type { PermissionDecision, PermissionRule } from '../permissions/types';
import type { SubAgent } from './types';

export interface SubAgentParseInput {
  source: string;
  filePath: string;
  /** Used as fallback name when frontmatter has none. */
  fallbackName: string;
}

const DECISIONS = new Set<PermissionDecision>(['allow', 'deny', 'ask']);

/**
 * Build a SubAgent from a parsed Markdown source.
 *
 * Frontmatter (YAML):
 *
 *   ---
 *   name: explorer
 *   description: Fast read-only search agent
 *   type: subagent                # 'primary' | 'subagent', default 'subagent'
 *   color: "#ff8c00"               # optional
 *   tools:                         # three forms accepted:
 *     - read                       # array → flat allow-list
 *     - list_dir
 *   # OR
 *   # tools: read, list_dir        # comma-separated string
 *   # OR
 *   # tools:                       # object → per-tool permissions
 *   #   read: allow
 *   #   bash:
 *   #     "git *": allow
 *   #     "**": ask
 *   ---
 *
 *   You are an explorer agent. Your job is to ...
 */
export function parseSubAgent({ source, filePath, fallbackName }: SubAgentParseInput): SubAgent {
  const { fields, body } = parseFrontmatter(source);
  const name = readString(fields.name) ?? fallbackName;
  const description = readString(fields.description) ?? '';

  if (!name) {
    throw new Error(`Sub-agent at ${filePath}: missing "name" frontmatter and no fallback`);
  }
  if (!description) {
    throw new Error(`Sub-agent at ${filePath}: missing "description" frontmatter`);
  }
  if (!body.trim()) {
    throw new Error(`Sub-agent at ${filePath}: empty prompt body`);
  }

  const { tools, permissions } = parseTools(fields.tools, filePath);
  const type = readString(fields.type);
  const color = readString(fields.color);

  return {
    name,
    description,
    prompt: body.trim(),
    tools,
    permissions,
    type: type === 'primary' || type === 'subagent' ? type : undefined,
    filePath,
    color,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseTools(
  raw: unknown,
  filePath: string,
): { tools: string[]; permissions: PermissionRule[] } {
  if (raw === undefined || raw === null || raw === '*' || raw === '') {
    return { tools: ['*'], permissions: [] };
  }

  if (Array.isArray(raw)) {
    const tools = raw.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean);
    return { tools, permissions: [] };
  }

  if (typeof raw === 'string') {
    const tools = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return { tools, permissions: [] };
  }

  if (typeof raw === 'object') {
    const entries = Object.entries(raw as Record<string, unknown>);
    const tools: string[] = [];
    const permissions: PermissionRule[] = [];
    for (const [toolName, value] of entries) {
      if (typeof value === 'string') {
        if (!DECISIONS.has(value as PermissionDecision)) {
          throw new Error(`Sub-agent at ${filePath}: invalid decision "${value}" for ${toolName}`);
        }
        permissions.push({ tool: toolName, decision: value as PermissionDecision });
        // Whitelist: only tools with at least one allow/ask decision are exposed to the LLM.
        if (value !== 'deny') tools.push(toolName);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        let anyAllowOrAsk = false;
        for (const [glob, decision] of Object.entries(value as Record<string, unknown>)) {
          if (typeof decision !== 'string' || !DECISIONS.has(decision as PermissionDecision)) {
            throw new Error(
              `Sub-agent at ${filePath}: invalid decision "${String(decision)}" for ${toolName}["${glob}"]`,
            );
          }
          permissions.push({ tool: toolName, argsPattern: glob, decision: decision as PermissionDecision });
          if (decision !== 'deny') anyAllowOrAsk = true;
        }
        // Per-arg rules: visible to the LLM iff at least one branch is allow/ask.
        if (anyAllowOrAsk) tools.push(toolName);
        continue;
      }
      throw new Error(`Sub-agent at ${filePath}: invalid tool entry for "${toolName}"`);
    }
    return { tools, permissions };
  }

  throw new Error(`Sub-agent at ${filePath}: unsupported "tools" frontmatter shape`);
}
