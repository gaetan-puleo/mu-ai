import type { Skill } from './types';

export interface SkillRegistry {
  list(): Skill[];
  get(name: string): Skill | undefined;
  add(skill: Skill): void;
  replaceAll(skills: Skill[]): void;
  select(names: string[]): SkillRegistry;
}

export const createSkillRegistry = (skills: Skill[] = []): SkillRegistry => {
  const byName = new Map<string, Skill>();
  const load = (list: Skill[]): void => {
    byName.clear();
    for (const skill of list) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  };
  load(skills);

  const view = (allow?: Set<string>): SkillRegistry => ({
    list: () => [...byName.values()].filter((skill) => !allow || allow.has(skill.name)),
    get: (name) => (!allow || allow.has(name) ? byName.get(name) : undefined),
    add: (skill) => {
      byName.set(skill.name, skill);
      allow?.add(skill.name);
    },
    replaceAll: (list) => load(list),
    select: (names) => view(new Set(allow ? names.filter((name) => allow.has(name)) : names)),
  });

  return view();
};
