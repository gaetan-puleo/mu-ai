import { assertEquals, assertStringIncludes } from '@std/assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkill } from './parser';
import { createSkillRegistry } from './registry';
import { createSkillTool } from './tool';
import { createSkillWriterTool } from './writer';

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

Deno.test('create_skill writes locally by default and to config on demand, and registers', async () => {
  const root = await Deno.makeTempDir();
  const local = join(root, 'local');
  const config = join(root, 'config');
  const reg = createSkillRegistry();
  const tool = createSkillWriterTool({ dirs: { local, config }, registry: reg });

  const made = await tool.run({ name: 'My Skill', description: 'd', instructions: 'BODY' }, {});
  assertStringIncludes((made[0] as { text: string }).text, join(local, 'my-skill', 'SKILL.md'));
  assertEquals(reg.get('my-skill')?.prompt, 'BODY');
  assertStringIncludes(await readFile(join(local, 'my-skill', 'SKILL.md'), 'utf-8'), 'BODY');

  const global = await tool.run({ name: 'glob', description: 'd', instructions: 'G', scope: 'config' }, {});
  assertStringIncludes((global[0] as { text: string }).text, join(config, 'glob', 'SKILL.md'));
  assertEquals(reg.get('glob')?.dir, join(config, 'glob'));

  await Deno.remove(root, { recursive: true });
});
