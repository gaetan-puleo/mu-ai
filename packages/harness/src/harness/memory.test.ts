import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore, createRememberTool } from './memory';

test('memory: remember writes per scope, load merges global + project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mu-test-'));
  const cwd = join(root, 'proj');
  const dataDir = join(root, 'data');
  const store = createMemoryStore({ cwd, dataDir });

  expect(await store.load()).toEqual(undefined);

  await store.remember('user prefers tabs', 'local');
  await store.remember('always use the published mu', 'global');

  const loaded = (await store.load()) ?? '';
  expect(loaded).toContain('user prefers tabs');
  expect(loaded).toContain('always use the published mu');
  // global scope is listed before project scope
  expect(loaded.indexOf('global') < loaded.indexOf('project')).toEqual(true);

  await rm(root, { recursive: true, force: true });
});

test('remember tool persists the fact and defaults to local scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mu-test-'));
  const store = createMemoryStore({ cwd: join(root, 'p'), dataDir: join(root, 'd') });
  const tool = createRememberTool(store);

  const res = await tool.run({ fact: 'the deploy host is x' }, { signal: undefined });
  expect((res[0] as { text: string }).text).toContain('Remembered (local)');
  expect((await store.load()) ?? '').toContain('the deploy host is x');

  await rm(root, { recursive: true, force: true });
});
