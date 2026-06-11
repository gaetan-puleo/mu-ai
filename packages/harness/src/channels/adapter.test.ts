import { assertEquals, assertStrictEquals } from '@std/assert';
import type { Provider } from 'mu-core';
import { createAgentSession } from '../session';
import { createApprovalManager } from '../permissions';
import type { Harness } from '../harness/types';
import { type ChannelAdapter, runChannels } from './adapter';

const idle = (): Provider => ({
  async *stream() {},
});

const stubHarness = (): Harness =>
  ({
    sessions: { create: () => createAgentSession({ provider: idle(), model: 'mock' }) },
  }) as unknown as Harness;

Deno.test('runChannels starts each adapter with a shared manager + approvals', async () => {
  const approvals = createApprovalManager();
  const harness = stubHarness();
  const calls: string[] = [];

  const adapter: ChannelAdapter = {
    name: 'mem',
    start: (ctx) => {
      calls.push('start');
      assertStrictEquals(ctx.approvals, approvals);
      assertStrictEquals(ctx.harness, harness);
      ctx.manager.open({ id: 'a', title: 'A' });
      return Promise.resolve({
        stop: () => {
          calls.push('stop');
          return Promise.resolve();
        },
      });
    },
  };

  const host = await runChannels({ harness, approvals, adapters: [adapter] });
  assertEquals(calls, ['start']);
  assertEquals(host.manager.get('a')?.title, 'A');

  await host.stop();
  assertEquals(calls, ['start', 'stop']);
  assertEquals(host.manager.get('a'), undefined);
});

Deno.test('runChannels stops adapters in reverse order', async () => {
  const approvals = createApprovalManager();
  const order: string[] = [];
  const make = (name: string): ChannelAdapter => ({
    name,
    start: () =>
      Promise.resolve({
        stop: () => {
          order.push(name);
          return Promise.resolve();
        },
      }),
  });

  const host = await runChannels({ harness: stubHarness(), approvals, adapters: [make('a'), make('b')] });
  await host.stop();
  assertEquals(order, ['b', 'a']);
});
