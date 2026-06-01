import { assertEquals } from '@std/assert';
import type { Tool } from 'mu-core';
import type { AgentSessionHooks } from './types';
import { withHooks } from './with-hooks';

const dynamicTool = (catalog: string[]): Tool => ({
  name: 'skill',
  description: 'loads a skill',
  parameters: {},
  get prompt() {
    return catalog.join(',');
  },
  run: async () => [{ type: 'text', text: 'ran' }],
});

Deno.test('withHooks: without before/after hooks, returns the tool unchanged', () => {
  const tool = dynamicTool(['a']);
  assertEquals(withHooks(tool, {}), tool);
});

Deno.test('withHooks: preserves the dynamic prompt getter', () => {
  const catalog = ['a'];
  const hooks: AgentSessionHooks = { beforeToolCall: () => undefined };
  const wrapped = withHooks(dynamicTool(catalog), hooks);

  assertEquals(wrapped.prompt, 'a');
  catalog.push('b');
  assertEquals(wrapped.prompt, 'a,b');
});

Deno.test('withHooks: beforeToolCall can block before the run', async () => {
  const hooks: AgentSessionHooks = {
    beforeToolCall: () => [{ type: 'text', text: 'denied' }],
  };
  const wrapped = withHooks(dynamicTool(['a']), hooks);
  assertEquals(await wrapped.run({}, {}), [{ type: 'text', text: 'denied' }]);
});

Deno.test('withHooks: afterToolCall can rewrite the result', async () => {
  const hooks: AgentSessionHooks = {
    afterToolCall: ({ result }) => [...result, { type: 'text', text: 'extra' }],
  };
  const wrapped = withHooks(dynamicTool(['a']), hooks);
  assertEquals(await wrapped.run({}, {}), [{ type: 'text', text: 'ran' }, { type: 'text', text: 'extra' }]);
});
