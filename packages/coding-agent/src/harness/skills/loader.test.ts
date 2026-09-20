import { expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkillsFromRoots, loadSkillsSpec, summarizeIssues } from './loader';

test('loadSkillsSpec: loads flat and category skills, reports issues', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mu-skills-'));
  try {
    await mkdir(join(root, 'good-skill'), { recursive: true });
    await writeFile(join(root, 'good-skill', 'SKILL.md'), '---\nname: good-skill\ndescription: A good skill.\n---\nBody.');
    await mkdir(join(root, 'cat', 'nested-skill'), { recursive: true });
    await writeFile(join(root, 'cat', 'nested-skill', 'SKILL.md'), '---\nname: nested-skill\ndescription: Nested.\n---\nBody.');
    await mkdir(join(root, 'bad-skill'), { recursive: true });
    await writeFile(join(root, 'bad-skill', 'SKILL.md'), '---\nname: WRONG_NAME\n---\nBody.');

    const skills = await loadSkillsSpec(root);
    expect(skills.length).toBe(3);
    expect(skills.find((s) => s.dirName === 'good-skill')?.valid).toBe(true);
    expect(skills.find((s) => s.dirName === 'nested-skill')?.valid).toBe(true);
    const bad = skills.find((s) => s.dirName === 'bad-skill');
    expect(bad?.valid).toBe(false);
    expect(bad?.issues.some((i) => i.field === 'name')).toBe(true);
    expect(bad?.issues.some((i) => i.field === 'description')).toBe(true);
    expect(summarizeIssues(skills).length).toBe(bad!.issues.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadSkillsFromRoots: later root overrides by name', async () => {
  const a = await mkdtemp(join(tmpdir(), 'mu-skills-a-'));
  const b = await mkdtemp(join(tmpdir(), 'mu-skills-b-'));
  try {
    await mkdir(join(a, 'shared'), { recursive: true });
    await writeFile(join(a, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: from A.\n---\nA body.');
    await mkdir(join(b, 'shared'), { recursive: true });
    await writeFile(join(b, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: from B.\n---\nB body.');
    const skills = await loadSkillsFromRoots([a, b]);
    expect(skills.length).toBe(1);
    expect(skills[0].skill.description).toBe('from B.');
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test('loadSkillsSpec: missing root yields empty', async () => {
  expect(await loadSkillsSpec('/nonexistent/mu-skills-root')).toEqual([]);
});
