import { parseFrontmatter, str } from '../common';
import type { Agent, GrantValue, ToolDecision, ToolGrants } from './types';

const DECISIONS = new Set<ToolDecision>(['allow', 'ask', 'deny']);

const isDecision = (value: unknown): value is ToolDecision =>
  typeof value === 'string' && DECISIONS.has(value as ToolDecision);

const parseStringList = (raw: string | unknown[]): string[] =>
  (Array.isArray(raw) ? raw : raw.split(','))
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseDecisionMap = (raw: Record<string, unknown>): Record<string, ToolDecision> | undefined => {
  const out: Record<string, ToolDecision> = {};
  for (const [key, value] of Object.entries(raw)) if (isDecision(value)) out[key] = value;
  return Object.keys(out).length > 0 ? out : undefined;
};

const parseTools = (raw: unknown): ToolGrants | undefined => {
  if (Array.isArray(raw) || typeof raw === 'string') {
    const list = parseStringList(raw);
    return list.length > 0 ? list : undefined;
  }
  if (raw && typeof raw === 'object') {
    const out: Record<string, GrantValue> = {};
    for (const [tool, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isDecision(value)) out[tool] = value;
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = parseDecisionMap(value as Record<string, unknown>);
        if (nested) out[tool] = nested;
      }
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
