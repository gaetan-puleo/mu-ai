import { describe, expect, it } from 'bun:test';
import type { LifecycleHooks, MessageBus, Plugin, UserInputTransform } from '../plugin';
import { PluginRegistry } from '../registry';
import type { Session } from '../session';
import type { ChatMessage, ProviderConfig } from '../types/llm';
import { runHostTurn } from './runHostTurn';

function fakeConfig(): ProviderConfig {
  return { baseUrl: 'http://x', maxTokens: 1, temperature: 0, streamTimeoutMs: 1000 };
}

interface FakeSession {
  session: Session;
  calls: Array<{ userMessage?: ChatMessage; queue: ChatMessage[] }>;
}

function fakeSession(): FakeSession {
  const calls: FakeSession['calls'] = [];
  let queue: ChatMessage[] = [];
  const session: Session = {
    id: 's',
    getMessages: () => [],
    setMessages: () => undefined,
    runTurn: async (opts) => {
      calls.push({ userMessage: opts.userMessage, queue: queue.slice() });
      queue = [];
      return null;
    },
    abort: () => undefined,
    appendSynthetic: () => undefined,
    queueForNextTurn: (msg) => {
      queue.push(msg);
    },
    subscribe: () => () => undefined,
  };
  return { session, calls };
}

function fakeBus(): MessageBus & { queued: ChatMessage[] } {
  const queued: ChatMessage[] = [];
  return {
    append: () => undefined,
    injectNext: (m) => {
      queued.push(m);
    },
    drainNext: () => {
      const out = queued.slice();
      queued.length = 0;
      return out;
    },
    subscribe: () => () => undefined,
    get: () => [],
    queued,
  };
}

function registryWithHook(hook: LifecycleHooks): PluginRegistry {
  const reg = new PluginRegistry({ cwd: '/', config: {} });
  const plugin: Plugin = { name: 'test', hooks: hook };
  void reg.register(plugin);
  return reg;
}

describe('runHostTurn', () => {
  it('handles a "pass" transform — runs the turn with the original text', async () => {
    const { session, calls } = fakeSession();
    const reg = new PluginRegistry({ cwd: '/', config: {} });
    const bus = fakeBus();
    const outcome = await runHostTurn({
      session,
      registry: reg,
      messageBus: bus,
      userText: 'hello',
      config: fakeConfig(),
    });
    expect(outcome).toEqual({ kind: 'ran' });
    expect(calls.length).toBe(1);
    expect(calls[0]?.userMessage?.content).toBe('hello');
  });

  it('handles "intercept" — does NOT run the turn', async () => {
    const { session, calls } = fakeSession();
    const reg = registryWithHook({
      transformUserInput: () => ({ kind: 'intercept' }) satisfies UserInputTransform,
    });
    const outcome = await runHostTurn({
      session,
      registry: reg,
      messageBus: fakeBus(),
      userText: 'x',
      config: fakeConfig(),
    });
    expect(outcome).toEqual({ kind: 'intercepted' });
    expect(calls.length).toBe(0);
  });

  it('handles "transform" — runs the turn with rewritten text', async () => {
    const { session, calls } = fakeSession();
    const reg = registryWithHook({
      transformUserInput: () => ({ kind: 'transform', text: 'REWRITTEN' }) satisfies UserInputTransform,
    });
    const outcome = await runHostTurn({
      session,
      registry: reg,
      messageBus: fakeBus(),
      userText: 'raw',
      config: fakeConfig(),
    });
    expect(outcome).toEqual({ kind: 'ran' });
    expect(calls[0]?.userMessage?.content).toBe('REWRITTEN');
  });

  it('handles "continue" — runs the turn with NO userMessage', async () => {
    const { session, calls } = fakeSession();
    const reg = registryWithHook({
      transformUserInput: () => ({ kind: 'continue' }) satisfies UserInputTransform,
    });
    const outcome = await runHostTurn({
      session,
      registry: reg,
      messageBus: fakeBus(),
      userText: '@review do x',
      config: fakeConfig(),
    });
    expect(outcome).toEqual({ kind: 'continued' });
    expect(calls.length).toBe(1);
    expect(calls[0]?.userMessage).toBeUndefined();
  });

  it('drains messageBus injections into the session queue', async () => {
    const { session, calls } = fakeSession();
    const reg = new PluginRegistry({ cwd: '/', config: {} });
    const bus = fakeBus();
    bus.injectNext({ role: 'system', content: 'inject' });
    await runHostTurn({
      session,
      registry: reg,
      messageBus: bus,
      userText: 'hi',
      config: fakeConfig(),
    });
    expect(calls[0]?.queue.length).toBe(1);
    expect(calls[0]?.queue[0]?.content).toBe('inject');
  });

  it('applies decorateUserMessage after plugin decorations', async () => {
    const { session, calls } = fakeSession();
    const reg = new PluginRegistry({ cwd: '/', config: {} });
    await runHostTurn({
      session,
      registry: reg,
      messageBus: fakeBus(),
      userText: 'hi',
      config: fakeConfig(),
      decorateUserMessage: (m) => ({ ...m, content: `${m.content}!!!` }),
    });
    expect(calls[0]?.userMessage?.content).toBe('hi!!!');
  });
});
