import { parseFrontmatter, str } from '../common';
import type { Agent, ToolDecision, ToolGrants } from './types';

const DECISIONS = new Set<ToolDecision>(['allow', 'ask', 'deny']);

const parseStringList = (raw: string | unknown[]): string[] =>
  (Array.isArray(raw) ? raw : raw.split(','))
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseTools = (raw: unknown): ToolGrants | undefined => {
  if (Array.isArray(raw) || typeof raw === 'string') {
    const list = parseStringList(raw);
    return list.length > 0 ? list : undefined;
  }
  if (raw && typeof raw === 'object') {
    const out: Record<string, ToolDecision> = {};
    for (const [tool, decision] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof decision === 'string' && DECISIONS.has(decision as ToolDecision)) out[tool] = decision as ToolDecision;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
};

export const parseAgent = (source: string, fallbackName: string): Agent => {
  const { fields, body } = parseFrontmatter(source);

  return {
    name: str(fields.name) ?? fallbackName,
    description: str(fields.description) ?? '',
    prompt: body,
    tools: parseTools(fields.tools),
    model: str(fields.model),
    color: str(fields.color),
    extends: str(fields.extends),
  };
};
