import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkill } from './parser';
import type { Skill } from './types';

export const loadSkills = async (dir: string): Promise<Skill[]> => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries.sort()) {
    const skillDir = join(dir, entry);
    try {
      if (!(await stat(skillDir)).isDirectory()) continue;
      const source = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
      skills.push(parseSkill(source, entry, skillDir));
    } catch {
      continue;
    }
  }
  return skills;
};
