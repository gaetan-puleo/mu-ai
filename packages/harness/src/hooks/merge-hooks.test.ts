import { assertEquals } from '@std/assert';
import type { Tool } from 'mu-core';
import { mergeHooks } from './merge-hooks';

const tool = (name: string): Tool => ({ name, description: '', parameters: {}, run: async () => [] });

Deno.test('prepareRequest chains system + tools from hook to hook', async () => {
  const merged = mergeHooks([
    { prepareRequest: ({ tools }) => ({ tools: tools.filter((t) => t.name !== 'bash') }) },
    { prepareRequest: ({ system }) => ({ system: `${system} [gated]` }) },
  ]);

  const out = await merged.prepareRequest?.({ system: 'base', tools: [tool('read'), tool('bash')] });
  assertEquals(out?.system, 'base [gated]');
  assertEquals(out?.tools?.map((t) => t.name), ['read']);
});

Deno.test('beforeToolCall short-circuits at the first one that returns a result', async () => {
  const order: string[] = [];
  const merged = mergeHooks([
    {
      beforeToolCall: () => {
        order.push('a');
      },
    },
    {
      beforeToolCall: () => {
        order.push('b');
        return [{ type: 'text', text: 'denied' }];
      },
    },
    {
      beforeToolCall: () => {
        order.push('c');
      },
    },
  ]);

  const blocked = await merged.beforeToolCall?.({ name: 'x', input: {} });
  assertEquals(blocked, [{ type: 'text', text: 'denied' }]);
  assertEquals(order, ['a', 'b']);
});

Deno.test('afterToolCall chains the transformations', async () => {
  const merged = mergeHooks([
    { afterToolCall: ({ result }) => [...result, { type: 'text', text: '1' }] },
    { afterToolCall: ({ result }) => [...result, { type: 'text', text: '2' }] },
  ]);

  const out = await merged.afterToolCall?.({ name: 'x', result: [{ type: 'text', text: '0' }] });
  assertEquals(out, [
    { type: 'text', text: '0' },
    { type: 'text', text: '1' },
    { type: 'text', text: '2' },
  ]);
});

Deno.test('only defines the hooks that are actually present', () => {
  const merged = mergeHooks([{ sessionStart: () => {} }, undefined]);
  assertEquals(typeof merged.sessionStart, 'function');
  assertEquals(merged.beforeToolCall, undefined);
  assertEquals(merged.afterToolCall, undefined);
});
