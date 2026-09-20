import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseSkill } from './parser';
import { skillMatchesPlatform } from './platform';
import { validateSkill, type SkillIssue } from './spec';
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

/** A skill loaded with its spec-validation result. */
export interface LoadedSkill {
  dir: string;
  dirName: string;
  skill: Skill;
  issues: SkillIssue[];
  valid: boolean;
}

/** Load every skill under `root`, each carrying its spec-validation issues.
 * Mirrors `loadSkills`' directory conventions but does not filter by platform,
 * so validation covers everything on disk. Non-existent roots yield []. */
export async function loadSkillsSpec(root: string): Promise<LoadedSkill[]> {
  const out: LoadedSkill[] = [];

  const tryLoad = async (skillDir: string): Promise<boolean> => {
    let source: string;
    try {
      source = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
    } catch {
      return false;
    }
    const dirName = basename(skillDir);
    const skill = parseSkill(source, dirName, skillDir);
    const issues = validateSkill(skill, dirName);
    out.push({ dir: skillDir, dirName, skill, issues, valid: issues.length === 0 });
    return true;
  };

  for (const entry of await readDirSorted(root)) {
    const entryDir = join(root, entry);
    if (!(await isDir(entryDir))) continue;
    if (await tryLoad(entryDir)) continue;
    for (const child of await readDirSorted(entryDir)) {
      const childDir = join(entryDir, child);
      if (await isDir(childDir)) await tryLoad(childDir);
    }
  }
  return out;
}

/** Load skills from several roots. Later roots override earlier ones by skill name. */
export async function loadSkillsFromRoots(roots: string[]): Promise<LoadedSkill[]> {
  const byName = new Map<string, LoadedSkill>();
  for (const root of roots) {
    for (const s of await loadSkillsSpec(root)) {
      byName.set(s.skill.name || s.dirName, s);
    }
  }
  return [...byName.values()];
}

/** A compact summary of validation problems across loaded skills, for reporting. */
export function summarizeIssues(skills: LoadedSkill[]): string[] {
  const lines: string[] = [];
  for (const s of skills) {
    for (const i of s.issues) lines.push(`${s.dirName} · ${i.field}: ${i.message}`);
  }
  return lines;
}
