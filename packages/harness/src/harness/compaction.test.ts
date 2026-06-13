import { assertEquals, assertStringIncludes } from '@std/assert';
import type { Message, Provider } from 'mu-core';
import { createAgentSession } from '../session';
import { createCompactionHook } from './compaction';

Deno.test('session.compact summarizes the middle, keeping system + last N', async () => {
  const provider: Provider = {
    async *stream() {
      yield { type: 'text', text: 'CONDENSED SUMMARY' };
    },
  };
  const messages: Message[] = [
    { role: 'system', content: [{ type: 'text', text: 'SYS' }] },
    { role: 'user', content: [{ type: 'text', text: 'm1' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'r1' }] },
    { role: 'user', content: [{ type: 'text', text: 'm2' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'r2' }] },
    { role: 'user', content: [{ type: 'text', text: 'm3' }] },
  ];
  const session = createAgentSession({ provider, model: 'm', messages });

  await session.compact!({ keepLastTurns: 2 });

  const out = session.messages;
  assertEquals(out.length, 4); // system + summary + last 2
  assertEquals(out[0].role, 'system');
  assertStringIncludes(out[1].content.map((p) => (p.type === 'text' ? p.text : '')).join(''), 'CONDENSED SUMMARY');
  assertEquals(out[3].content[0], { type: 'text', text: 'm3' });
});

Deno.test('compaction hook fires compact only past the threshold', async () => {
  const hook = createCompactionHook({ thresholdPct: 0.5, keepLastTurns: 2 });
  const big: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(400) }] }];
  const small: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];

  let compacted = false;
  const run = (messages: Message[]) =>
    hook.afterTurn!({
      messages,
      countTokens: () => Promise.resolve(undefined),
      contextWindow: () => Promise.resolve(100), // 100-token window; threshold 0.5 → 50
      compact: () => {
        compacted = true;
        return Promise.resolve();
      },
    });

  await run(small);
  assertEquals(compacted, false); // ~1 token, under 50
  await run(big);
  assertEquals(compacted, true); // 400 chars ≈ 100 tokens, over 50
});
