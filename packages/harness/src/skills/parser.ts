import { parseFrontmatter, str, strList } from '../common';
import type { Skill } from './types';

export const parseSkill = (source: string, fallbackName: string, dir?: string): Skill => {
  const { fields, body } = parseFrontmatter(source);

  const platforms = strList(fields.platforms);
  const skill: Skill = {
    name: str(fields.name) ?? fallbackName,
    description: str(fields.description) ?? '',
    prompt: body,
  };
  // Emit optional keys only when present — strict-equality tests rely on no `undefined`-valued keys.
  if (dir !== undefined) skill.dir = dir;
  if (platforms.length) skill.platforms = platforms;
  const command = str(fields.command);
  if (command) skill.command = command;
  return skill;
};
