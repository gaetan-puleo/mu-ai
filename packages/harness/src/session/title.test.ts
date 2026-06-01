import { assertEquals } from '@std/assert';
import { cleanTitle, runTitler, titleFallback } from './title';

Deno.test('titleFallback: collapses whitespace and truncates', () => {
  assertEquals(titleFallback('  hello   world  '), 'hello world');
  assertEquals(titleFallback('x'.repeat(80), 10), `${'x'.repeat(9)}…`);
});

Deno.test('cleanTitle: strip think, first non-empty line, quotes, truncate', () => {
  assertEquals(cleanTitle('<think>hmm</think>\n  "Fix the bug"  '), 'Fix the bug');
  assertEquals(cleanTitle('\n\nReal Title\nignored'), 'Real Title');
});

Deno.test('runTitler: sets the fallback then the generated title', async () => {
  const writes: string[] = [];
  await runTitler({
    id: 's1',
    text: 'aide moi a debugger le serveur',
    setTitle: (_id, value) => {
      writes.push(value);
    },
    generate: () => Promise.resolve('Debug du serveur'),
  });
  assertEquals(writes, ['aide moi a debugger le serveur', 'Debug du serveur']);
});

Deno.test('runTitler: if generate fails, keeps the fallback', async () => {
  const writes: string[] = [];
  await runTitler({
    id: 's1',
    text: 'hello world',
    setTitle: (_id, value) => {
      writes.push(value);
    },
    generate: () => Promise.reject(new Error('no internet')),
  });
  assertEquals(writes, ['hello world']);
});
