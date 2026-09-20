import { expect, test } from 'vitest';
import type { Tool } from 'mu-core';
import { mergeHooks } from './merge-hooks';

const tool = (name: string): Tool => ({ name, description: '', parameters: {}, run: async () => [] });

test('prepareRequest chains system + tools from hook to hook', async () => {
  const merged = mergeHooks([
    { prepareRequest: ({ tools }) => ({ tools: tools.filter((t) => t.name !== 'bash') }) },
    { prepareRequest: ({ system }) => ({ system: `${system} [gated]` }) },
  ]);

  const out = await merged.prepareRequest?.({ system: 'base', tools: [tool('read'), tool('bash')] });
  expect(out?.system).toEqual('base [gated]');
  expect(out?.tools?.map((t) => t.name)).toEqual(['read']);
});

test('beforeToolCall short-circuits at the first one that returns a result', async () => {
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
  expect(blocked).toEqual([{ type: 'text', text: 'denied' }]);
  expect(order).toEqual(['a', 'b']);
});

test('afterToolCall chains the transformations', async () => {
  const merged = mergeHooks([
    { afterToolCall: ({ result }) => [...result, { type: 'text', text: '1' }] },
    { afterToolCall: ({ result }) => [...result, { type: 'text', text: '2' }] },
  ]);

  const out = await merged.afterToolCall?.({ name: 'x', result: [{ type: 'text', text: '0' }] });
  expect(out).toEqual([
    { type: 'text', text: '0' },
    { type: 'text', text: '1' },
    { type: 'text', text: '2' },
  ]);
});

test('only defines the hooks that are actually present', () => {
  const merged = mergeHooks([{ sessionStart: () => {} }, undefined]);
  expect(typeof merged.sessionStart).toEqual('function');
  expect(merged.beforeToolCall).toEqual(undefined);
  expect(merged.afterToolCall).toEqual(undefined);
});
