import { assertEquals } from '@std/assert';
import type { Message } from 'mu-core';
import { createSessionStore } from './store';

const msg = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

Deno.test('store JSONL: append accumulates (one line per message) and load reconstructs', async () => {
  const dir = await Deno.makeTempDir();
  const store = createSessionStore({ dir });

  await store.append('s1', [msg('a'), msg('b')]);
  await store.append('s1', [msg('c')]);

  const raw = await Deno.readTextFile(`${dir}/s1.jsonl`);
  assertEquals(raw.trim().split('\n').length, 3);

  const loaded = await store.load('s1');
  assertEquals(loaded.id, 's1');
  assertEquals(loaded.messages.map((m) => (m.content[0] as { text: string }).text), ['a', 'b', 'c']);

  await store.delete('s1');

  await Deno.remove(dir, { recursive: true });
});
