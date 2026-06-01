import { assertEquals, assertRejects } from '@std/assert';
import type { ContentPart, Provider } from 'mu-core';
import type { Agent } from '../agents';
import { createAgentRegistry } from '../agents';
import { createAgentSession } from '../session';
import { runSubAgent } from './runner';
import { createSubAgentTool } from './tool';

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++]) yield event;
    },
  };
};

const reviewer: Agent = { name: 'reviewer', description: 'reviews', prompt: 'You review.' };

const spawnReturning = (text: string) => () =>
  createAgentSession({ provider: scripted([[{ type: 'text', text }]]), model: 'mock' });

Deno.test('runSubAgent sends the task and returns the final text', async () => {
  const result = await runSubAgent(reviewer, 'audit X', { spawn: spawnReturning('looks good') });
  assertEquals(result, { agent: 'reviewer', text: 'looks good' });
});

Deno.test('runSubAgent: parent abort cancels the subagent (no blocking)', async () => {
  const blockUntilAbort: Provider = {
    async *stream({ signal }) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      yield { type: 'text', text: 'cancelled' };
    },
  };
  const ac = new AbortController();
  const pending = runSubAgent(reviewer, 'go', {
    spawn: () => createAgentSession({ provider: blockUntilAbort, model: 'mock' }),
    signal: ac.signal,
  });
  ac.abort();
  assertEquals(await pending, { agent: 'reviewer', text: 'cancelled' });
});

Deno.test('runSubAgent: a provider error propagates (no fake empty success)', async () => {
  const failing: Provider = {
    // deno-lint-ignore require-yield
    async *stream() {
      throw new Error('provider down');
    },
  };
  await assertRejects(
    () => runSubAgent(reviewer, 'go', { spawn: () => createAgentSession({ provider: failing, model: 'mock' }) }),
    Error,
    'provider down',
  );
});

Deno.test('the spawn receives the persona (system = prompt)', async () => {
  let seen: string | undefined;
  await runSubAgent(reviewer, 'go', {
    spawn: (agent) => {
      seen = agent.prompt;
      return createAgentSession({ provider: scripted([[{ type: 'text', text: 'ok' }]]), model: 'mock' });
    },
  });
  assertEquals(seen, 'You review.');
});

Deno.test('the tool delegates to the named persona from the registry', async () => {
  const tool = createSubAgentTool({ registry: createAgentRegistry([reviewer]), spawn: spawnReturning('done') });
  assertEquals(await tool.run({ agent: 'reviewer', task: 'audit' }, {}), [{ type: 'text', text: 'done' }]);
});

Deno.test('the tool handles unknown agent and missing arguments', async () => {
  const tool = createSubAgentTool({ registry: createAgentRegistry([reviewer]), spawn: spawnReturning('x') });
  assertEquals(await tool.run({ agent: 'nope', task: 't' }, {}), [{
    type: 'text',
    text: 'Error: unknown sub-agent "nope".',
  }]);
  assertEquals(await tool.run({ agent: 'reviewer' }, {}), [{
    type: 'text',
    text: 'Error: subagent requires `agent` and `task`.',
  }]);
});
