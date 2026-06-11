import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseSkill } from './parser';
import { skillMatchesPlatform } from './platform';
import type { Skill } from './types';

const isHidden = (name: string): boolean => name.startsWith('.'); // .git, .github, .hub, dotfiles

const readDirSorted = async (dir: string): Promise<string[]> => {
  try {
    return (await readdir(dir)).filter((e) => !isHidden(e)).sort();
  } catch {
    return [];
  }
};

const isDir = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

export const loadSkills = async (dir: string, current: string = process.platform): Promise<Skill[]> => {
  const skills: Skill[] = [];

  // Load the skill at `skillDir` if it has a SKILL.md. Returns true when it WAS a skill dir.
  const tryLoad = async (skillDir: string): Promise<boolean> => {
    let source: string;
    try {
      source = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
    } catch {
      return false;
    }
    const skill = parseSkill(source, basename(skillDir), skillDir);
    if (skillMatchesPlatform(skill.platforms, current)) skills.push(skill);
    return true;
  };

  for (const entry of await readDirSorted(dir)) {
    const entryDir = join(dir, entry);
    if (!(await isDir(entryDir))) continue;
    if (await tryLoad(entryDir)) continue; // flat: dir/<skill>/SKILL.md
    for (const child of await readDirSorted(entryDir)) { // category: dir/<category>/<skill>/SKILL.md
      const childDir = join(entryDir, child);
      if (await isDir(childDir)) await tryLoad(childDir);
    }
  }
  return skills;
};
