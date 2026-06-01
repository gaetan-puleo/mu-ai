import { parseFrontmatter, str } from '../common';
import type { Skill } from './types';

export const parseSkill = (source: string, fallbackName: string, dir?: string): Skill => {
  const { fields, body } = parseFrontmatter(source);

  return {
    name: str(fields.name) ?? fallbackName,
    description: str(fields.description) ?? '',
    prompt: body,
    dir,
  };
};
