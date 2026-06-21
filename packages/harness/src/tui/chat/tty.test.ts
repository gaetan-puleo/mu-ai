import { expect, test, vi } from 'vitest';
import type { ModelModalities } from 'mu-core';
import { createApprovalManager } from '../../permissions';
import type { Harness } from '../../harness/types';
import { type AgentControl, inProcessChatHost, ttyAdapter } from './tty';

const flush = () => new Promise((r) => setTimeout(r, 0));

const stubAgent = (): AgentControl => ({
  ref: () => 'build',
  color: () => '#fff',
  cycle: () => 'plan',
  primaryNames: () => ['build', 'plan'],
});

/** Minimal harness exposing only what inProcessChatHost touches. */
const stubHarness = (over: Partial<Record<string, unknown>> = {}): Harness => {
  let selected = 'local/a';
  return {
    cwd: '/work',
    models: {
      get selected() {
        return selected;
      },
      select: (ref: string) => {
        selected = ref;
      },
      capabilities: async (): Promise<ModelModalities | undefined> => ({ vision: true, audio: false }),
      ...(over.models as object),
    },
    agents: { list: () => [{ name: 'build' }, { name: 'plan' }, { name: 'title' }, { name: 'helper' }] },
    sessions: {
      create: () => ({ id: 's-new' }),
      fork: async (id: string) => ({ id: `${id}-fork` }),
      list: async () => [{ id: 's1' }],
      open: async (id: string) => ({ id }),
    },
    subAgents: { register: () => {}, get: () => undefined, list: () => [], byParent: () => [], subscribe: () => () => {} },
    dispatchSubAgent: async () => ({ agent: 'x', text: 'done' }),
    commands: { list: () => [{ name: 'help', description: 'Help' }], run: async () => ({ ok: true }) },
  } as unknown as Harness;
};

test('ttyAdapter is a ChannelAdapter named "tty"', () => {
  const adapter = ttyAdapter({ listModels: async () => [], agent: stubAgent() });
  expect(adapter.name).toBe('tty');
  expect(typeof adapter.start).toBe('function');
});

test('inProcessChatHost delegates session + model reads to the harness', async () => {
  const harness = stubHarness();
  const host = inProcessChatHost(harness, createApprovalManager(), { listModels: async () => [], agent: stubAgent() });

  expect(host.cwd).toBe('/work');
  expect(host.modelRef()).toBe('local/a');
  expect(host.createSession()).toEqual({ id: 's-new' });
  expect(await host.openSession('s1')).toEqual({ id: 's1' });
  expect(await host.forkSession('s1', 0)).toEqual({ id: 's1-fork' });
});

test('agentNames drops the configured primaries and the internal "title" agent', () => {
  const host = inProcessChatHost(stubHarness(), createApprovalManager(), {
    listModels: async () => [],
    agent: stubAgent(),
  });
  expect(host.agentNames()).toEqual(['helper']);
});

test('selectModel persists the ref, selects it, and probes capabilities behind a loading state', async () => {
  const harness = stubHarness();
  const onModelSelected = vi.fn();
  const features = { vision: false, audio: true };
  const host = inProcessChatHost(harness, createApprovalManager(), {
    listModels: async () => [],
    agent: stubAgent(),
    capabilities: features,
    onModelSelected,
  });

  const events: Array<[string, boolean]> = [];
  host.subscribeModelLoading?.((model, loading) => events.push([model, loading]));

  host.selectModel('local/b');
  expect(onModelSelected).toHaveBeenCalledWith('local/b');
  expect(host.modelRef()).toBe('local/b'); // harness.models.select ran synchronously
  expect(events).toEqual([['local/b', true]]); // loading starts before the async probe

  await flush();
  expect(events).toEqual([['local/b', true], ['local/b', false]]);
  // Probe reported { vision: true, audio: false } — features object refined in place.
  expect(host.features).toMatchObject({ vision: true, audio: false });
});
