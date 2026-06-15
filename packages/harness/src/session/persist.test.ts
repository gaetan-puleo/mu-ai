import { assertEquals } from '@std/assert';
import type { Message } from 'mu-core';
import type { AgentSession, AssembledRequest } from './types';
import { persistTo } from './persist';
import type { SessionStore } from './store';

const noopStore = { append: async () => {} } as unknown as SessionStore;

const msg = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const textOf = (m: Message): string => m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');

// Regression guard: session decorators must forward `assembleRequest`, or /context and
// /context-export silently lose the real assembled prompt (they did — this is why).
Deno.test('persistTo forwards assembleRequest from the wrapped session', async () => {
  const req: AssembledRequest = { system: 'S', tools: [], messages: [] };
  const inner = {
    id: 'x',
    messages: [],
    tools: [],
    assembleRequest: () => Promise.resolve(req),
    send: async () => {},
    abort: () => {},
    subscribe: () => () => {},
  } as unknown as AgentSession;

  const wrapped = persistTo(noopStore, inner);
  assertEquals(await wrapped.assembleRequest!(), req);
});

Deno.test('persistTo rewrites the log when compaction rewrites history in place', async () => {
  const writes: { kind: 'append' | 'rewrite'; messages: string[] }[] = [];
  const store = {
    append: async (_id: string, m: Message[]) => void writes.push({ kind: 'append', messages: m.map(textOf) }),
    rewrite: async (_id: string, m: readonly Message[]) =>
      void writes.push({ kind: 'rewrite', messages: m.map(textOf) }),
  } as unknown as SessionStore;

  const messages: Message[] = [];
  let turn = 0;
  const inner = {
    id: 's',
    get messages() {
      return messages;
    },
    tools: [],
    send: async () => {
      turn++;
      messages.push(msg(`m${turn}`));
      if (turn === 4) messages.splice(0, 3, msg('summary'));
    },
    abort: () => {},
    subscribe: () => () => {},
  } as unknown as AgentSession;

  const wrapped = persistTo(store, inner);
  await wrapped.send('a');
  await wrapped.send('b');
  await wrapped.send('c');
  await wrapped.send('d');

  assertEquals(writes.map((w) => w.kind), ['append', 'append', 'append', 'rewrite']);
  assertEquals(writes[3].messages, ['summary', 'm4']);
});
