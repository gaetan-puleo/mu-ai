import { parseFrontmatter, str } from '../common';
import type { Agent } from './types';

const parseToolList = (raw: unknown): string[] | undefined => {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(
      Boolean,
    );
  }
  if (typeof raw === 'string') return raw.split(',').map((part) => part.trim()).filter(Boolean);
  return undefined;
};

export const parseAgent = (source: string, fallbackName: string): Agent => {
  const { fields, body } = parseFrontmatter(source);

  return {
    name: str(fields.name) ?? fallbackName,
    description: str(fields.description) ?? '',
    prompt: body,
    tools: parseToolList(fields.tools),
    model: str(fields.model),
    color: str(fields.color),
    extends: str(fields.extends),
  };
};
