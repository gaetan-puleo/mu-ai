import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionCatalog } from './catalog';

test('catalog SQLite: record / get / setTitle / list by cwd / delete', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'mu-test-'));
  const cat = createSessionCatalog({ file: `${dir}/sessions.db` });

  cat.record('a', { cwd: '/proj/x' });
  cat.record('b', { cwd: '/proj/x' });
  cat.record('c', { cwd: '/proj/y' });
  cat.setTitle('a', 'Titre A');

  expect(cat.get('a')?.title).toEqual('Titre A');
  expect(cat.get('a')?.cwd).toEqual('/proj/x');
  expect(cat.list({ cwd: '/proj/x' }).map((r) => r.id).sort()).toEqual(['a', 'b']);
  expect(cat.list().length).toEqual(3);

  cat.delete('a');
  expect(cat.get('a')).toEqual(undefined);
  expect(cat.list({ cwd: '/proj/x' }).map((r) => r.id)).toEqual(['b']);

  cat.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('catalog: children (parentId) are excluded from list() and listable by parent', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'mu-test-'));
  const cat = createSessionCatalog({ file: `${dir}/sessions.db` });

  cat.record('parent', { cwd: '/p' });
  cat.record('child-1', { parentId: 'parent' });
  cat.record('child-2', { parentId: 'parent' });

  expect(cat.list().map((r) => r.id)).toEqual(['parent']);
  expect(cat.list({ cwd: '/p' }).map((r) => r.id)).toEqual(['parent']);
  expect(cat.list({ parentId: 'parent' }).map((r) => r.id).sort()).toEqual(['child-1', 'child-2']);
  expect(cat.get('child-1')?.parentId).toEqual('parent');

  cat.close();
  await fs.rm(dir, { recursive: true, force: true });
});
