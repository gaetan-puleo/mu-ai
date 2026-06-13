import { assertEquals, assertStringIncludes } from '@std/assert';
import { join } from 'node:path';
import { createMemoryStore, createRememberTool } from './memory';

Deno.test('memory: remember writes per scope, load merges global + project', async () => {
  const root = await Deno.makeTempDir();
  const cwd = join(root, 'proj');
  const dataDir = join(root, 'data');
  const store = createMemoryStore({ cwd, dataDir });

  assertEquals(await store.load(), undefined);

  await store.remember('user prefers tabs', 'local');
  await store.remember('always use the published mu', 'global');

  const loaded = (await store.load()) ?? '';
  assertStringIncludes(loaded, 'user prefers tabs');
  assertStringIncludes(loaded, 'always use the published mu');
  // global scope is listed before project scope
  assertEquals(loaded.indexOf('global') < loaded.indexOf('project'), true);

  await Deno.remove(root, { recursive: true });
});

Deno.test('remember tool persists the fact and defaults to local scope', async () => {
  const root = await Deno.makeTempDir();
  const store = createMemoryStore({ cwd: join(root, 'p'), dataDir: join(root, 'd') });
  const tool = createRememberTool(store);

  const res = await tool.run({ fact: 'the deploy host is x' }, { signal: undefined });
  assertStringIncludes((res[0] as { text: string }).text, 'Remembered (local)');
  assertStringIncludes((await store.load()) ?? '', 'the deploy host is x');

  await Deno.remove(root, { recursive: true });
});
