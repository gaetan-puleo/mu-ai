import { assertEquals } from '@std/assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dirsForPath, loadInstructions } from './instructions';

Deno.test('loadInstructions merges global + local (cwd) + nested accessed subdir scopes', async () => {
  const root = await Deno.makeTempDir();
  const cfg = join(root, 'config');
  const proj = join(root, 'proj');
  const sub = join(proj, 'pkg', 'a');
  await mkdir(cfg, { recursive: true });
  await mkdir(sub, { recursive: true });
  await writeFile(join(cfg, 'AGENTS.md'), 'GLOBAL RULES');
  await writeFile(join(proj, 'AGENTS.md'), 'PROJECT RULES');
  await writeFile(join(sub, 'AGENTS.md'), 'NESTED PKG RULES');

  // Without accessing the subdir: only global + project.
  const base = (await loadInstructions(proj, cfg)) ?? '';
  assertEquals(base.includes('GLOBAL RULES'), true);
  assertEquals(base.includes('PROJECT RULES'), true);
  assertEquals(base.includes('NESTED PKG RULES'), false);

  // After "touching" a file under pkg/a, its AGENTS.md is included and lands LAST (most specific).
  const accessed = dirsForPath(proj, 'pkg/a/file.ts');
  const withNested = (await loadInstructions(proj, cfg, { accessed })) ?? '';
  assertEquals(withNested.includes('NESTED PKG RULES'), true);
  assertEquals(withNested.lastIndexOf('NESTED PKG RULES') > withNested.indexOf('PROJECT RULES'), true);

  await Deno.remove(root, { recursive: true });
});

Deno.test('dirsForPath returns the dir chain up to cwd, and nothing for outside paths', () => {
  assertEquals(dirsForPath('/x/proj', 'a/b/c.ts'), ['/x/proj/a/b', '/x/proj/a', '/x/proj']);
  assertEquals(dirsForPath('/x/proj', '../outside.ts'), []);
});
