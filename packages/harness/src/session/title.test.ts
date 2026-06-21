import { expect, test } from 'vitest';
import { cleanTitle, runTitler, titleFallback } from './title';

test('titleFallback: collapses whitespace and truncates', () => {
  expect(titleFallback('  hello   world  ')).toEqual('hello world');
  expect(titleFallback('x'.repeat(80), 10)).toEqual(`${'x'.repeat(9)}…`);
});

test('cleanTitle: strip think, first non-empty line, quotes, truncate', () => {
  expect(cleanTitle('<think>hmm</think>\n  "Fix the bug"  ')).toEqual('Fix the bug');
  expect(cleanTitle('\n\nReal Title\nignored')).toEqual('Real Title');
});

test('runTitler: sets the fallback then the generated title', async () => {
  const writes: string[] = [];
  await runTitler({
    id: 's1',
    text: 'aide moi a debugger le serveur',
    setTitle: (_id, value) => {
      writes.push(value);
    },
    generate: () => Promise.resolve('Debug du serveur'),
  });
  expect(writes).toEqual(['aide moi a debugger le serveur', 'Debug du serveur']);
});

test('runTitler: if generate fails, keeps the fallback', async () => {
  const writes: string[] = [];
  await runTitler({
    id: 's1',
    text: 'hello world',
    setTitle: (_id, value) => {
      writes.push(value);
    },
    generate: () => Promise.reject(new Error('no internet')),
  });
  expect(writes).toEqual(['hello world']);
});
