import { assertEquals, assertStringIncludes } from '@std/assert';
import type { AgentSession } from '../session';
import { createContextCommand } from './defaults';

const sessionWith = (over: Partial<AgentSession>): AgentSession =>
  ({
    assembleRequest: () =>
      Promise.resolve({
        system: 'AGENT PROMPT\n\n<env>\ncwd: /x\n</env>\n\n[tool: read]',
        tools: [{ name: 'read', description: 'reads', parameters: {}, run: async () => [] }],
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'sys' }] },
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      }),
    ...over,
  }) as unknown as AgentSession;

Deno.test('context splits system/context/tools + messages by role with exact tokens + heatmap', async () => {
  const session = sessionWith({
    countTokens: (text: string) => Promise.resolve(text ? 10 : 0),
    contextWindow: () => Promise.resolve(1000),
  });
  const out = String((await createContextCommand().run('', { session })).output);

  assertStringIncludes(out, 'context ·'); // header
  assertStringIncludes(out, 'system');
  assertStringIncludes(out, 'context'); // the <env> block is its own category
  assertStringIncludes(out, 'tools');
  assertStringIncludes(out, 'you'); // user messages split out by role
  assertStringIncludes(out, 'buffer'); // compaction reserve category
  assertStringIncludes(out, 'free');
  assertStringIncludes(out, '%'); // window fill
  assertStringIncludes(out, '·'); // heatmap free cells (only rendered with a window)
});

Deno.test('context falls back to a chars/4 estimate (marked ~) and renders no grid without a window', async () => {
  const out = String((await createContextCommand().run('', { session: sessionWith({}) })).output);
  assertStringIncludes(out, '~'); // estimate marker on the token counts
  assertEquals(out.includes('free'), false); // no contextWindow → no buffer/free rows, no heatmap
});

Deno.test('context is graceful with no live session', async () => {
  const res = await createContextCommand().run('', {});
  assertEquals(res.ok, true);
  assertStringIncludes(String(res.output), 'No session in memory yet');
});
