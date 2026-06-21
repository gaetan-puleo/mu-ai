import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkill } from './parser';
import { loadSkills } from './loader';
import { skillMatchesPlatform } from './platform';
import { createSkillRegistry } from './registry';
import { createSkillTool } from './tool';

test('parseSkill reads the frontmatter and keeps the body as prompt', () => {
  const skill = parseSkill(
    `---\nname: commit\ndescription: write a commit message\n---\nFollow conventional commits.`,
    'fallback',
    '/skills/commit',
  );
  expect(skill).toEqual({
    name: 'commit',
    description: 'write a commit message',
    prompt: 'Follow conventional commits.',
    dir: '/skills/commit',
  });
});

test('parseSkill reads the optional command field (absent => undefined)', () => {
  expect(parseSkill('---\nname: x\ndescription: d\ncommand: do-x\n---\nbody', 'x').command).toEqual('do-x');
  expect(parseSkill('---\nname: y\ndescription: d\n---\nbody', 'y').command).toEqual(undefined);
});

test('parseSkill without frontmatter: body = prompt, name = fallback', () => {
  const skill = parseSkill('just do it', 'helper');
  expect(skill.name).toEqual('helper');
  expect(skill.prompt).toEqual('just do it');
  expect(skill.dir).toEqual(undefined);
});

test('registry: first wins, add replaces', () => {
  const reg = createSkillRegistry([
    { name: 'a', description: 'host', prompt: 'H' },
    { name: 'a', description: 'disk', prompt: 'D' },
  ]);
  expect(reg.get('a')?.description).toEqual('host');
  reg.add({ name: 'a', description: 'new', prompt: 'N' });
  expect(reg.get('a')?.description).toEqual('new');
  expect(reg.list().length).toEqual(1);
});

test('registry: replaceAll rebuilds in place — add, edit and delete', () => {
  const reg = createSkillRegistry([
    { name: 'a', description: 'A1', prompt: 'PA' },
    { name: 'b', description: 'B', prompt: 'PB' },
  ]);
  expect(reg.list().map((s) => s.name).sort()).toEqual(['a', 'b']);
  reg.replaceAll([
    { name: 'a', description: 'A2', prompt: 'PA2' }, // edited
    { name: 'c', description: 'C', prompt: 'PC' }, // added; b removed
  ]);
  expect(reg.list().map((s) => s.name).sort()).toEqual(['a', 'c']);
  expect(reg.get('a')?.description).toEqual('A2');
  expect(reg.get('b')).toEqual(undefined);
});

test('skill tool: dynamic catalog and body loading', async () => {
  const reg = createSkillRegistry();
  const tool = createSkillTool(reg);
  expect(tool.description.includes('matches one of these skills')).toEqual(false);

  reg.add({ name: 'commit', description: 'write a commit message', prompt: 'BODY', dir: '/s/commit' });
  expect(tool.description.includes('commit: write a commit message')).toEqual(true);

  const ok = await tool.run({ name: 'commit' }, {});
  expect(ok[0]).toEqual({ type: 'text', text: 'Skill "commit" (bundled files live under /s/commit):\n\nBODY' });

  const missing = await tool.run({ name: 'nope' }, {});
  expect(missing[0]).toEqual({ type: 'text', text: 'Error: unknown skill "nope".' });
});

test('skill tool over a select() view: catalog and loading are scoped', async () => {
  const reg = createSkillRegistry([
    { name: 'research', description: 'deep research', prompt: 'R' },
    { name: 'commit', description: 'write a commit message', prompt: 'C' },
  ]);
  const scoped = reg.select(['research']);
  const tool = createSkillTool(scoped);

  expect(tool.description.includes('research: deep research')).toEqual(true);
  expect(tool.description.includes('commit: write a commit message')).toEqual(false);

  const ok = await tool.run({ name: 'research' }, {});
  expect(ok[0]).toEqual({ type: 'text', text: 'Skill "research":\n\nR' });

  const denied = await tool.run({ name: 'commit' }, {});
  expect(denied[0]).toEqual({ type: 'text', text: 'Error: unknown skill "commit".' });
});

const writeSkill = async (root: string, relDir: string, frontmatter: string, body = 'BODY'): Promise<void> => {
  const dir = join(root, relDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
};

test('skillMatchesPlatform: empty matches all; map + startsWith; unknown false', () => {
  expect(skillMatchesPlatform(undefined, 'linux')).toEqual(true);
  expect(skillMatchesPlatform([], 'linux')).toEqual(true);
  expect(skillMatchesPlatform(['macos'], 'darwin')).toEqual(true);
  expect(skillMatchesPlatform(['windows'], 'linux')).toEqual(false);
  expect(skillMatchesPlatform(['solaris'], 'linux')).toEqual(false);
});

test('parseSkill normalizes platforms (string or list); omits key when absent', () => {
  expect(parseSkill('---\nname: a\nplatforms: linux\n---\nB', 'fb').platforms).toEqual(['linux']);
  expect(parseSkill('---\nname: a\nplatforms: [macos, linux]\n---\nB', 'fb').platforms).toEqual(['macos', 'linux']);
  expect('platforms' in parseSkill('---\nname: a\n---\nB', 'fb')).toEqual(false);
});

test('loadSkills: flat + one-level category nesting, fallback name = skill basename', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'mu-test-'));
  await writeSkill(root, 'commit', 'name: commit\ndescription: d');
  await writeSkill(root, join('dev', 'review'), 'description: d'); // no name → fallback to basename

  const skills = await loadSkills(root, 'linux');
  const names = skills.map((s) => s.name).sort();
  expect(names).toEqual(['commit', 'review']);

  await fs.rm(root, { recursive: true, force: true });
});

test('loadSkills: OS gating keeps matching, skips mismatching, loads when absent', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'mu-test-'));
  await writeSkill(root, 'lin', 'name: lin\ndescription: d\nplatforms: [linux]');
  await writeSkill(root, 'mac', 'name: mac\ndescription: d\nplatforms: [macos]');
  await writeSkill(root, 'any', 'name: any\ndescription: d');

  expect((await loadSkills(root, 'linux')).map((s) => s.name).sort()).toEqual(['any', 'lin']);
  expect((await loadSkills(root, 'win32')).map((s) => s.name).sort()).toEqual(['any']);
  expect((await loadSkills(root, 'darwin')).map((s) => s.name).sort()).toEqual(['any', 'mac']);

  await fs.rm(root, { recursive: true, force: true });
});

test('loadSkills: hidden dirs (.git/.hub) are skipped at both levels', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'mu-test-'));
  await writeSkill(root, '.git', 'name: g\ndescription: d');
  await writeSkill(root, join('.hub', 'foo'), 'name: foo\ndescription: d');
  await writeSkill(root, 'real', 'name: real\ndescription: d');

  expect((await loadSkills(root, 'linux')).map((s) => s.name)).toEqual(['real']);

  await fs.rm(root, { recursive: true, force: true });
});
