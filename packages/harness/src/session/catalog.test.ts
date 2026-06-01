import { assertEquals } from '@std/assert';
import { createSessionCatalog } from './catalog';

Deno.test('catalog SQLite: record / get / setTitle / list by cwd / delete', async () => {
  const dir = await Deno.makeTempDir();
  const cat = createSessionCatalog({ file: `${dir}/sessions.db` });

  cat.record('a', { cwd: '/proj/x' });
  cat.record('b', { cwd: '/proj/x' });
  cat.record('c', { cwd: '/proj/y' });
  cat.setTitle('a', 'Titre A');

  assertEquals(cat.get('a')?.title, 'Titre A');
  assertEquals(cat.get('a')?.cwd, '/proj/x');
  assertEquals(cat.list({ cwd: '/proj/x' }).map((r) => r.id).sort(), ['a', 'b']);
  assertEquals(cat.list().length, 3);

  cat.delete('a');
  assertEquals(cat.get('a'), undefined);
  assertEquals(cat.list({ cwd: '/proj/x' }).map((r) => r.id), ['b']);

  cat.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test('catalog: children (parentId) are excluded from list() and listable by parent', async () => {
  const dir = await Deno.makeTempDir();
  const cat = createSessionCatalog({ file: `${dir}/sessions.db` });

  cat.record('parent', { cwd: '/p' });
  cat.record('child-1', { parentId: 'parent' });
  cat.record('child-2', { parentId: 'parent' });

  assertEquals(cat.list().map((r) => r.id), ['parent']);
  assertEquals(cat.list({ cwd: '/p' }).map((r) => r.id), ['parent']);
  assertEquals(cat.list({ parentId: 'parent' }).map((r) => r.id).sort(), ['child-1', 'child-2']);
  assertEquals(cat.get('child-1')?.parentId, 'parent');

  cat.close();
  await Deno.remove(dir, { recursive: true });
});
