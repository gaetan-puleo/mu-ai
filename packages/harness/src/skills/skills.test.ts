import { assertEquals } from '@std/assert';
import { join } from 'node:path';
import { parseSkill } from './parser';
import { loadSkills } from './loader';
import { skillMatchesPlatform } from './platform';
import { createSkillRegistry } from './registry';
import { createSkillTool } from './tool';

Deno.test('parseSkill reads the frontmatter and keeps the body as prompt', () => {
  const skill = parseSkill(
    `---\nname: commit\ndescription: write a commit message\n---\nFollow conventional commits.`,
    'fallback',
    '/skills/commit',
  );
  assertEquals(skill, {
    name: 'commit',
    description: 'write a commit message',
    prompt: 'Follow conventional commits.',
    dir: '/skills/commit',
  });
});

Deno.test('parseSkill reads the optional command field (absent => undefined)', () => {
  assertEquals(parseSkill('---\nname: x\ndescription: d\ncommand: do-x\n---\nbody', 'x').command, 'do-x');
  assertEquals(parseSkill('---\nname: y\ndescription: d\n---\nbody', 'y').command, undefined);
});

Deno.test('parseSkill without frontmatter: body = prompt, name = fallback', () => {
  const skill = parseSkill('just do it', 'helper');
  assertEquals(skill.name, 'helper');
  assertEquals(skill.prompt, 'just do it');
  assertEquals(skill.dir, undefined);
});

Deno.test('registry: first wins, add replaces', () => {
  const reg = createSkillRegistry([
    { name: 'a', description: 'host', prompt: 'H' },
    { name: 'a', description: 'disk', prompt: 'D' },
  ]);
  assertEquals(reg.get('a')?.description, 'host');
  reg.add({ name: 'a', description: 'new', prompt: 'N' });
  assertEquals(reg.get('a')?.description, 'new');
  assertEquals(reg.list().length, 1);
});

Deno.test('registry: replaceAll rebuilds in place — add, edit and delete', () => {
  const reg = createSkillRegistry([
    { name: 'a', description: 'A1', prompt: 'PA' },
    { name: 'b', description: 'B', prompt: 'PB' },
  ]);
  assertEquals(reg.list().map((s) => s.name).sort(), ['a', 'b']);
  reg.replaceAll([
    { name: 'a', description: 'A2', prompt: 'PA2' }, // edited
    { name: 'c', description: 'C', prompt: 'PC' }, // added; b removed
  ]);
  assertEquals(reg.list().map((s) => s.name).sort(), ['a', 'c']);
  assertEquals(reg.get('a')?.description, 'A2');
  assertEquals(reg.get('b'), undefined);
});

Deno.test('skill tool: dynamic catalog and body loading', async () => {
  const reg = createSkillRegistry();
  const tool = createSkillTool(reg);
  assertEquals(tool.description.includes('matches one of these skills'), false);

  reg.add({ name: 'commit', description: 'write a commit message', prompt: 'BODY', dir: '/s/commit' });
  assertEquals(tool.description.includes('commit: write a commit message'), true);

  const ok = await tool.run({ name: 'commit' }, {});
  assertEquals(ok[0], { type: 'text', text: 'Skill "commit" (bundled files live under /s/commit):\n\nBODY' });

  const missing = await tool.run({ name: 'nope' }, {});
  assertEquals(missing[0], { type: 'text', text: 'Error: unknown skill "nope".' });
});

Deno.test('skill tool over a select() view: catalog and loading are scoped', async () => {
  const reg = createSkillRegistry([
    { name: 'research', description: 'deep research', prompt: 'R' },
    { name: 'commit', description: 'write a commit message', prompt: 'C' },
  ]);
  const scoped = reg.select(['research']);
  const tool = createSkillTool(scoped);

  assertEquals(tool.description.includes('research: deep research'), true);
  assertEquals(tool.description.includes('commit: write a commit message'), false);

  const ok = await tool.run({ name: 'research' }, {});
  assertEquals(ok[0], { type: 'text', text: 'Skill "research":\n\nR' });

  const denied = await tool.run({ name: 'commit' }, {});
  assertEquals(denied[0], { type: 'text', text: 'Error: unknown skill "commit".' });
});

const writeSkill = async (root: string, relDir: string, frontmatter: string, body = 'BODY'): Promise<void> => {
  const dir = join(root, relDir);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
};

Deno.test('skillMatchesPlatform: empty matches all; map + startsWith; unknown false', () => {
  assertEquals(skillMatchesPlatform(undefined, 'linux'), true);
  assertEquals(skillMatchesPlatform([], 'linux'), true);
  assertEquals(skillMatchesPlatform(['macos'], 'darwin'), true);
  assertEquals(skillMatchesPlatform(['windows'], 'linux'), false);
  assertEquals(skillMatchesPlatform(['solaris'], 'linux'), false);
});

Deno.test('parseSkill normalizes platforms (string or list); omits key when absent', () => {
  assertEquals(parseSkill('---\nname: a\nplatforms: linux\n---\nB', 'fb').platforms, ['linux']);
  assertEquals(parseSkill('---\nname: a\nplatforms: [macos, linux]\n---\nB', 'fb').platforms, ['macos', 'linux']);
  assertEquals('platforms' in parseSkill('---\nname: a\n---\nB', 'fb'), false);
});

Deno.test('loadSkills: flat + one-level category nesting, fallback name = skill basename', async () => {
  const root = await Deno.makeTempDir();
  await writeSkill(root, 'commit', 'name: commit\ndescription: d');
  await writeSkill(root, join('dev', 'review'), 'description: d'); // no name → fallback to basename

  const skills = await loadSkills(root, 'linux');
  const names = skills.map((s) => s.name).sort();
  assertEquals(names, ['commit', 'review']);

  await Deno.remove(root, { recursive: true });
});

Deno.test('loadSkills: OS gating keeps matching, skips mismatching, loads when absent', async () => {
  const root = await Deno.makeTempDir();
  await writeSkill(root, 'lin', 'name: lin\ndescription: d\nplatforms: [linux]');
  await writeSkill(root, 'mac', 'name: mac\ndescription: d\nplatforms: [macos]');
  await writeSkill(root, 'any', 'name: any\ndescription: d');

  assertEquals((await loadSkills(root, 'linux')).map((s) => s.name).sort(), ['any', 'lin']);
  assertEquals((await loadSkills(root, 'win32')).map((s) => s.name).sort(), ['any']);
  assertEquals((await loadSkills(root, 'darwin')).map((s) => s.name).sort(), ['any', 'mac']);

  await Deno.remove(root, { recursive: true });
});

Deno.test('loadSkills: hidden dirs (.git/.hub) are skipped at both levels', async () => {
  const root = await Deno.makeTempDir();
  await writeSkill(root, '.git', 'name: g\ndescription: d');
  await writeSkill(root, join('.hub', 'foo'), 'name: foo\ndescription: d');
  await writeSkill(root, 'real', 'name: real\ndescription: d');

  assertEquals((await loadSkills(root, 'linux')).map((s) => s.name), ['real']);

  await Deno.remove(root, { recursive: true });
});
