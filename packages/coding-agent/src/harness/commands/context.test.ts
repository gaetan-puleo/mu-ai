import { expect, test } from 'vitest';
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

test('context splits system/context/tools + messages by role with exact tokens + heatmap', async () => {
  const session = sessionWith({
    countTokens: (text: string) => Promise.resolve(text ? 10 : 0),
    contextWindow: () => Promise.resolve(1000),
  });
  const out = String((await createContextCommand().run('', { session })).output);

  expect(out).toContain('Context Usage'); // header
  expect(out).toContain('System prompt');
  expect(out).toContain('Environment'); // the <env> block is its own category
  expect(out).toContain('Tools');
  expect(out).toContain('You'); // user messages split out by role
  expect(out).toContain('Compaction buffer'); // compaction reserve category
  expect(out).toContain('Free space');
  expect(out).toContain('%'); // window fill
  expect(out).toContain('⛶'); // grid free cells (only rendered with a window)
});

test('context falls back to a chars/4 estimate (marked ~) and renders no grid without a window', async () => {
  const out = String((await createContextCommand().run('', { session: sessionWith({}) })).output);
  expect(out).toContain('~'); // estimate marker on the token counts
  expect(out.includes('Free space')).toEqual(false); // no contextWindow → no buffer/free rows, no grid
});

test('context is graceful with no live session', async () => {
  const res = await createContextCommand().run('', {});
  expect(res.ok).toEqual(true);
  expect(String(res.output)).toContain('No session in memory yet');
});
