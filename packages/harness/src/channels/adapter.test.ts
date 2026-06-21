import { expect, test } from 'vitest';
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

test('runChannels starts each adapter with a shared manager + approvals', async () => {
  const approvals = createApprovalManager();
  const harness = stubHarness();
  const calls: string[] = [];

  const adapter: ChannelAdapter = {
    name: 'mem',
    start: (ctx) => {
      calls.push('start');
      expect(ctx.approvals).toBe(approvals);
      expect(ctx.harness).toBe(harness);
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
  expect(calls).toEqual(['start']);
  expect(host.manager.get('a')?.title).toEqual('A');

  await host.stop();
  expect(calls).toEqual(['start', 'stop']);
  expect(host.manager.get('a')).toEqual(undefined);
});

test('runChannels stops adapters in reverse order', async () => {
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
  expect(order).toEqual(['b', 'a']);
});
