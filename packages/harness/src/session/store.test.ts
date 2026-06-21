import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message } from 'mu-core';
import { createSessionStore } from './store';

const msg = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

test('store JSONL: append accumulates (one line per message) and load reconstructs', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'mu-test-'));
  const store = createSessionStore({ dir });

  await store.append('s1', [msg('a'), msg('b')]);
  await store.append('s1', [msg('c')]);

  const raw = await fs.readFile(`${dir}/s1.jsonl`, 'utf8');
  expect(raw.trim().split('\n').length).toEqual(3);

  const loaded = await store.load('s1');
  expect(loaded.id).toEqual('s1');
  expect(loaded.messages.map((m) => (m.content[0] as { text: string }).text)).toEqual(['a', 'b', 'c']);

  await store.delete('s1');

  await fs.rm(dir, { recursive: true, force: true });
});
