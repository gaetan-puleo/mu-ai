import { parseFrontmatter } from '../markdown';
import type { Skill } from './types';

interface SkillParseInput {
  source: string;
  filePath: string;
  /** Used as fallback name when frontmatter has none. */
  fallbackName: string;
}

/**
 * Build a Skill from a parsed Markdown source. Throws if the resulting skill
 * is invalid (missing name or description after fallbacks).
 */
export function parseSkill({ source, filePath, fallbackName }: SkillParseInput): Skill {
  const { fields, body } = parseFrontmatter(source);
  const name = typeof fields.name === 'string' ? fields.name : fallbackName;
  const description = typeof fields.description === 'string' ? fields.description : '';

  if (!name) {
    throw new Error(`Skill at ${filePath}: missing "name" frontmatter and no fallback`);
  }
  if (!description) {
    throw new Error(`Skill at ${filePath}: missing "description" frontmatter`);
  }

  return {
    name,
    description,
    content: body.trim(),
    filePath,
  };
}
