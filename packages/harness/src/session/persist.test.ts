import { assertEquals } from '@std/assert';
import type { AgentSession, AssembledRequest } from './types';
import { persistTo } from './persist';
import type { SessionStore } from './store';

const noopStore = { append: async () => {} } as unknown as SessionStore;

// Regression guard: session decorators must forward `lastRequest`, or /context and
// /context-export silently lose the real assembled prompt (they did — this is why).
Deno.test('persistTo forwards lastRequest from the wrapped session', () => {
  const req: AssembledRequest = { system: 'S', tools: [], messages: [] };
  const inner = {
    id: 'x',
    messages: [],
    tools: [],
    lastRequest: req,
    send: async () => {},
    abort: () => {},
    subscribe: () => () => {},
  } as unknown as AgentSession;

  const wrapped = persistTo(noopStore, inner);
  assertEquals(wrapped.lastRequest, req);
});
