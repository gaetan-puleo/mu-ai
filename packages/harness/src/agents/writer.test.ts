import { assertEquals, assertStringIncludes } from '@std/assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgentRegistry } from './registry';
import { createAgentWriterTool } from './writer';

const text = (parts: unknown): string => (parts as Array<{ text: string }>)[0].text;

Deno.test('create_agent writes locally by default, registers live, and serializes tool grants', async () => {
  const root = await Deno.makeTempDir();
  const local = join(root, 'local');
  const config = join(root, 'config');
  const reg = createAgentRegistry();
  const tool = createAgentWriterTool({ dirs: { local, config }, registry: reg });

  const made = await tool.run({
    name: 'My Helper',
    description: 'helps with things',
    prompt: 'You are a helper.',
    tools: { read: 'allow', bash: 'ask' },
  }, {});

  const file = join(local, 'my-helper.md');
  assertStringIncludes(text(made), file);
  // Live registration: delegatable immediately, no restart.
  assertEquals(reg.get('my-helper')?.prompt, 'You are a helper.');
  assertEquals(reg.get('my-helper')?.tools, { read: 'allow', bash: 'ask' });
  // Persisted file round-trips through the loader frontmatter format.
  const src = await readFile(file, 'utf-8');
  assertStringIncludes(src, 'name: my-helper');
  assertStringIncludes(src, 'You are a helper.');

  await Deno.remove(root, { recursive: true });
});

Deno.test('create_agent honors scope: config', async () => {
  const root = await Deno.makeTempDir();
  const local = join(root, 'local');
  const config = join(root, 'config');
  const reg = createAgentRegistry();
  const tool = createAgentWriterTool({ dirs: { local, config }, registry: reg });

  const made = await tool.run({ name: 'glob', description: 'd', prompt: 'P', scope: 'config' }, {});
  assertStringIncludes(text(made), join(config, 'glob.md'));
  assertEquals(reg.get('glob')?.prompt, 'P');

  await Deno.remove(root, { recursive: true });
});

Deno.test('create_agent forceScope overrides the model scope and drops it from the schema', async () => {
  const root = await Deno.makeTempDir();
  const local = join(root, 'local');
  const config = join(root, 'config');
  const reg = createAgentRegistry();
  const tool = createAgentWriterTool({ dirs: { local, config }, registry: reg, forceScope: 'config' });

  const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
  assertEquals('scope' in props, false);

  const made = await tool.run({ name: 'forced', description: 'd', prompt: 'P', scope: 'local' }, {});
  assertStringIncludes(text(made), join(config, 'forced.md'));

  await Deno.remove(root, { recursive: true });
});

Deno.test('create_agent refuses a name that already exists in the registry', async () => {
  const root = await Deno.makeTempDir();
  const local = join(root, 'local');
  const config = join(root, 'config');
  const reg = createAgentRegistry([{ name: 'taken', description: '', prompt: 'X' }]);
  const tool = createAgentWriterTool({ dirs: { local, config }, registry: reg });

  const res = await tool.run({ name: 'Taken', description: 'd', prompt: 'P' }, {});
  assertStringIncludes(text(res), 'already exists');

  await Deno.remove(root, { recursive: true });
});

Deno.test('create_agent validates required fields', async () => {
  const reg = createAgentRegistry();
  const tool = createAgentWriterTool({ dirs: { local: '/x', config: '/y' }, registry: reg });
  const res = await tool.run({ name: 'x' }, {});
  assertStringIncludes(text(res), 'requires');
});
