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

  assertStringIncludes(out, 'Context Usage'); // header
  assertStringIncludes(out, 'System prompt');
  assertStringIncludes(out, 'Environment'); // the <env> block is its own category
  assertStringIncludes(out, 'Tools');
  assertStringIncludes(out, 'You'); // user messages split out by role
  assertStringIncludes(out, 'Compaction buffer'); // compaction reserve category
  assertStringIncludes(out, 'Free space');
  assertStringIncludes(out, '%'); // window fill
  assertStringIncludes(out, '⛶'); // grid free cells (only rendered with a window)
});

Deno.test('context falls back to a chars/4 estimate (marked ~) and renders no grid without a window', async () => {
  const out = String((await createContextCommand().run('', { session: sessionWith({}) })).output);
  assertStringIncludes(out, '~'); // estimate marker on the token counts
  assertEquals(out.includes('Free space'), false); // no contextWindow → no buffer/free rows, no grid
});

Deno.test('context is graceful with no live session', async () => {
  const res = await createContextCommand().run('', {});
  assertEquals(res.ok, true);
  assertStringIncludes(String(res.output), 'No session in memory yet');
});
