import { assertEquals, assertStringIncludes } from '@std/assert';
import type { AgentSession } from '../session';
import { createContextCommand } from './defaults';

Deno.test('context command reports the REAL assembled request (not the stored system)', async () => {
  const session = {
    lastRequest: {
      system: 'SYS-REAL [env block]\n[tool: read]',
      tools: [{ name: 'read', description: 'reads', parameters: {}, run: async () => [] }],
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'SYS-REAL [env block]\n[tool: read]' }] },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    },
  } as unknown as AgentSession;

  const res = await createContextCommand().run('', { session });
  assertEquals(res.ok, true);
  const out = String(res.output);
  assertStringIncludes(out, 'SYS-REAL [env block]'); // the exact system the model saw
  assertStringIncludes(out, 'read'); // the post-hook tool set
  assertStringIncludes(out, 'system    ~'); // per-component token estimate
});

Deno.test('context command is graceful before the first turn', async () => {
  const res = await createContextCommand().run('', {});
  assertEquals(res.ok, true);
  assertStringIncludes(String(res.output), 'No context assembled yet');
});
