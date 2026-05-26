import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createBus } from './bus';
import type { Plugin } from './plugin';
import type { LLMProvider } from './provider';
import type { CoreEvent } from './runtime';
import { createRuntime } from './runtime';
import { createInMemorySessionStore } from './session';
import type { Message } from './types/Message';

const store = createInMemorySessionStore();
const newSession = () => store.create();

function collectEvents(bus: ReturnType<typeof createBus<CoreEvent>>): CoreEvent[] {
  const events: CoreEvent[] = [];
  bus.subscribe((event) => events.push(event));
  return events;
}

function waitForAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function eventIndex(events: CoreEvent[], type: CoreEvent['type']): number {
  return events.findIndex((event) => event.type === type);
}

function providerPlugin(provider: LLMProvider): Plugin {
  return { name: 'test-provider', provider };
}

describe('createRuntime', () => {
  it('reacts to a user message and publishes assistant response', async () => {
    const provider: LLMProvider = async () => ({ content: 'Hello!' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    expect(events).toContainEqual({
      type: 'assistant_message',
      message: { role: 'assistant', content: 'Hello!' },
    });
  });

  it('calls tools and publishes tool result before assistant response', async () => {
    let callCount = 0;

    const provider: LLMProvider = async (messages) => {
      callCount++;

      if (callCount === 1) {
        return {
          tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '2 3' }],
        };
      }

      return {
        content: `Result: ${messages[messages.length - 1].content}`,
      };
    };

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        sum: {
          name: 'sum',
          description: 'Add two numbers',
          parameters: {},
          execute: () => '5',
          onError: () => 'sum failed',
        },
      },
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(events).toContainEqual({
      type: 'tool_call',
      call: { type: 'tool_call', id: '1', tool: 'sum', args: '2 3' },
    });

    expect(events).toContainEqual({
      type: 'tool_result',
      message: { role: 'tool', content: '5', tool_id: '1' },
    });

    expect(events).toContainEqual({
      type: 'assistant_message',
      message: { role: 'assistant', content: 'Result: 5' },
    });
  });

  it('publishes error for unknown tool', async () => {
    const provider: LLMProvider = async () => ({
      tool_calls: [{ type: 'tool_call', id: '1', tool: 'unknown', args: '{}' }],
    });

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Use tool' },
    });

    await waitForAsync();

    expect(
      events.some(
        (event) =>
          event.type === 'error' && event.error instanceof Error && event.error.message === 'Unknown tool: unknown',
      ),
    ).toBe(true);
  });

  it('publishes reasoning messages', async () => {
    const provider: LLMProvider = async () => ({
      reasoning: '\n  Thinking...\n',
      content: 'The answer is 42',
    });

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Question' },
    });

    await waitForAsync();

    expect(events).toContainEqual({
      type: 'reasoning_message',
      message: { role: 'reasoning', content: 'Thinking...' },
    });

    expect(events).toContainEqual({
      type: 'assistant_message',
      message: { role: 'assistant', content: 'The answer is 42' },
    });
  });

  it('publishes trimmed streamed reasoning messages', async () => {
    const provider: LLMProvider = async () =>
      (async function* () {
        yield { type: 'reasoning_delta', content: '\n  Thinking...' };
        yield { type: 'reasoning_delta', content: '\n' };
        yield { type: 'done', response: { content: 'The answer is 42' } };
      })();

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Question' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(events).toContainEqual({
      type: 'reasoning_message',
      message: { role: 'reasoning', content: 'Thinking...' },
    });
  });

  it('publishes context updates from provider responses', async () => {
    const context = {
      usage: { promptTokens: 1234, completionTokens: 56, totalTokens: 1290 },
      props: { n_ctx: 32000, total_slots: 4, model_path: 'model.gguf', model_alias: 'model' },
      currentSlot: { id: 0, n_ctx: 32000, is_processing: false },
    };
    const provider: LLMProvider = async () => ({ content: 'Hello!', context });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    expect(events).toContainEqual({
      type: 'context_update',
      context,
    });
    expect(eventIndex(events, 'assistant_message')).toBeLessThan(eventIndex(events, 'context_update'));
  });

  it('publishes context updates from streamed done responses', async () => {
    const context = {
      usage: { promptTokens: 1234, completionTokens: 56, totalTokens: 1290 },
      props: { n_ctx: 32000, total_slots: 4, model_path: 'model.gguf', model_alias: 'model' },
      currentSlot: { id: 0, n_ctx: 32000, is_processing: false },
    };
    const provider: LLMProvider = async () =>
      (async function* () {
        yield { type: 'delta', content: 'Hello!' };
        yield { type: 'done', response: { content: 'Hello!', context } };
      })();
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(events).toContainEqual({
      type: 'context_update',
      context,
    });
    expect(eventIndex(events, 'assistant_message')).toBeLessThan(eventIndex(events, 'context_update'));
  });

  it('publishes context after reasoning and assistant messages', async () => {
    const context = {
      usage: { promptTokens: 1234, completionTokens: 56, totalTokens: 1290 },
      props: { n_ctx: 32000, total_slots: 4, model_path: 'model.gguf', model_alias: 'model' },
      currentSlot: { id: 0, n_ctx: 32000, is_processing: false },
    };
    const provider: LLMProvider = async () => ({ reasoning: 'Thinking...', content: 'Hello!', context });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    expect(eventIndex(events, 'reasoning_message')).toBeLessThan(eventIndex(events, 'assistant_message'));
    expect(eventIndex(events, 'assistant_message')).toBeLessThan(eventIndex(events, 'context_update'));
  });

  it('injects only the runtime system prompt (tool-level systemPrompt is not auto-included)', async () => {
    const providerMessages: string[][] = [];
    const provider: LLMProvider = async (messages) => {
      providerMessages.push(messages.map((message) => `${message.role}:${message.content}`));
      return { content: 'Hello!' };
    };
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        webfetch: {
          name: 'webfetch',
          description: 'Fetch URLs',
          parameters: {},
          // Defined but intentionally ignored by the runtime — see buildProviderMessages.
          systemPrompt: 'Use webfetch for URLs.',
          execute: () => 'ok',
          onError: () => 'failed',
        },
      },
      bus,
      systemPrompt: 'You are helpful.',
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Hi' } });

    await waitForAsync();

    expect(providerMessages[0]).toEqual(['system:You are helpful.', 'user:Hi']);
    expect(events.some((event) => 'message' in event && event.message.role === 'system')).toBe(false);
  });

  it('recomputes the runtime system prompt on each provider call when it is a function', async () => {
    let promptVersion = 0;
    let callCount = 0;
    const providerMessages: string[][] = [];
    const provider: LLMProvider = async (messages) => {
      callCount++;
      providerMessages.push(messages.map((message) => `${message.role}:${message.content}`));
      if (callCount === 1) {
        promptVersion = 1;
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'dynamic', args: '{}' }] };
      }
      return { content: 'Done' };
    };
    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        dynamic: {
          name: 'dynamic',
          description: 'Dynamic tool',
          parameters: {},
          execute: () => 'ok',
          onError: () => 'failed',
        },
      },
      bus,
      systemPrompt: () => (promptVersion === 0 ? 'version 0' : 'version 1'),
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Start' } });

    await waitForAsync();
    await waitForAsync();

    expect(providerMessages[0]?.[0]).toBe('system:version 0');
    expect(providerMessages[1]?.[0]).toBe('system:version 1');
  });

  it('queues multiple user messages', async () => {
    const provider: LLMProvider = async () => ({ content: 'Response' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'First' },
    });

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Second' },
    });

    await waitForAsync();
    await waitForAsync();
    await waitForAsync();

    const assistantEvents = events.filter((e) => e.type === 'assistant_message');
    expect(assistantEvents).toHaveLength(2);
  });

  it('injects steering after the current tool turn before the next provider call', async () => {
    let callCount = 0;
    let resolveTool: (() => void) | undefined;
    const providerMessages: string[][] = [];

    const provider: LLMProvider = async (messages) => {
      callCount++;
      providerMessages.push(messages.map((message) => `${message.role}:${message.content}`));

      if (callCount === 1) {
        return {
          tool_calls: [{ type: 'tool_call', id: '1', tool: 'slow', args: '{}' }],
        };
      }

      return { content: 'Done' };
    };

    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        slow: {
          name: 'slow',
          description: 'Slow tool',
          parameters: {},
          execute: async () => {
            await new Promise<void>((resolve) => {
              resolveTool = resolve;
            });
            return 'tool done';
          },
          onError: () => 'tool failed',
        },
      },
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Start' } });
    await waitForAsync();

    bus.publish({ type: 'steer', message: { role: 'user', content: 'Change direction' } });
    resolveTool?.();
    await waitForAsync();
    await waitForAsync();

    expect(providerMessages[1]).toContain('tool:tool done');
    expect(providerMessages[1]).toContain('user:Change direction');
    expect(providerMessages[1].at(-1)).toBe('user:Change direction');
  });

  it('runs follow-up only after the agent would otherwise stop', async () => {
    let resolveFirstProvider: (() => void) | undefined;
    const providerMessages: string[][] = [];

    const provider: LLMProvider = async (messages) => {
      providerMessages.push(messages.map((message) => `${message.role}:${message.content}`));

      if (providerMessages.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstProvider = resolve;
        });
        return { content: 'First done' };
      }

      return { content: 'Follow-up done' };
    };

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);
    const runtime = createRuntime({ session: newSession(), plugins: [providerPlugin(provider)], tools: {}, bus });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Start' } });
    await waitForAsync();

    bus.publish({ type: 'follow_up', message: { role: 'user', content: 'After that' } });
    resolveFirstProvider?.();
    await waitForAsync();
    await waitForAsync();

    expect(providerMessages[0]).toEqual(['user:Start']);
    expect(providerMessages[1]).toContain('assistant:First done');
    expect(providerMessages[1]).toContain('user:After that');
    expect(events).toContainEqual({
      type: 'assistant_message',
      message: { role: 'assistant', content: 'Follow-up done' },
    });
  });

  it('emits queue updates when steering is queued and drained', async () => {
    let resolveTool: (() => void) | undefined;
    let callCount = 0;
    const provider: LLMProvider = async () => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'slow', args: '{}' }] };
      }
      return { content: 'Done' };
    };

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);
    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        slow: {
          name: 'slow',
          description: 'Slow tool',
          parameters: {},
          execute: async () => {
            await new Promise<void>((resolve) => {
              resolveTool = resolve;
            });
            return 'ok';
          },
          onError: () => 'failed',
        },
      },
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Start' } });
    await waitForAsync();

    bus.publish({ type: 'steer', message: { role: 'user', content: 'Steer now' } });
    expect(events).toContainEqual({
      type: 'queue_update',
      steering: [{ role: 'user', content: 'Steer now' }],
      followUp: [],
    });

    resolveTool?.();
    await waitForAsync();
    await waitForAsync();

    expect(events).toContainEqual({ type: 'queue_update', steering: [], followUp: [] });
  });

  it('emits queued message when steering is inserted into runtime order', async () => {
    let resolveTool: (() => void) | undefined;
    let callCount = 0;
    const provider: LLMProvider = async () => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'slow', args: '{}' }] };
      }
      return { content: 'Done' };
    };

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);
    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        slow: {
          name: 'slow',
          description: 'Slow tool',
          parameters: {},
          execute: async () => {
            await new Promise<void>((resolve) => {
              resolveTool = resolve;
            });
            return 'ok';
          },
          onError: () => 'failed',
        },
      },
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Start' } });
    await waitForAsync();
    bus.publish({ type: 'steer', message: { role: 'user', content: 'Steer now' } });
    resolveTool?.();
    await waitForAsync();
    await waitForAsync();

    const toolResultIndex = events.findIndex((event) => event.type === 'tool_result');
    const queuedIndex = events.findIndex((event) => event.type === 'queued_message');
    const assistantIndex = events.findIndex(
      (event) => event.type === 'assistant_message' && event.message.content === 'Done',
    );

    expect(events).toContainEqual({
      type: 'queued_message',
      queue: 'steering',
      message: { role: 'user', content: 'Steer now' },
    });
    expect(toolResultIndex).toBeGreaterThan(-1);
    expect(queuedIndex).toBeGreaterThan(toolResultIndex);
    expect(assistantIndex).toBeGreaterThan(queuedIndex);
  });

  it('stops processing when stop is called', async () => {
    const provider: LLMProvider = async () => ({ content: 'Response' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    await runtime.stop();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Ignored' },
    });

    await waitForAsync();

    const assistantEvents = events.filter((e) => e.type === 'assistant_message');
    expect(assistantEvents).toHaveLength(1);
  });

  it('reports idle state when no messages are queued', async () => {
    const provider: LLMProvider = async () => ({ content: 'Response' });
    const bus = createBus<CoreEvent>();

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    expect(runtime.state()).toBe('idle');

    await runtime.start();

    expect(runtime.state()).toBe('idle');
  });

  it('reports running state while processing', async () => {
    let resolveProvider: (() => void) | undefined;

    const provider: LLMProvider = async () => {
      await new Promise<void>((resolve) => {
        resolveProvider = resolve;
      });
      return { content: 'Response' };
    };

    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    expect(runtime.state()).toBe('running');

    resolveProvider?.();
    await waitForAsync();
  });

  it('uses plugin tools in array order', async () => {
    const providerMessages: string[][] = [];
    let callCount = 0;
    const provider: LLMProvider = async (messages, tools) => {
      callCount++;
      providerMessages.push(messages.map((message) => `${message.role}:${message.content}`));
      if (callCount === 1) {
        expect(Object.keys(tools)).toEqual(['base', 'plugin']);
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'plugin', args: '{}' }] };
      }
      return { content: messages.at(-1)?.content ?? '' };
    };
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);
    const plugin: Plugin = {
      name: 'plugin',
      tools: {
        plugin: {
          name: 'plugin',
          description: 'Plugin tool',
          parameters: {},
          execute: () => 'plugin result',
          onError: () => 'failed',
        },
      },
    };

    const runtime = createRuntime({ session: newSession(),
      tools: {
        base: {
          name: 'base',
          description: 'Base tool',
          parameters: {},
          execute: () => 'base',
          onError: () => 'failed',
        },
      },
      plugins: [providerPlugin(provider), plugin],
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Use plugin' } });

    await waitForAsync();
    await waitForAsync();

    expect(providerMessages[1]).toContain('tool:plugin result');
    expect(events).toContainEqual({
      type: 'tool_result',
      message: { role: 'tool', content: 'plugin result', tool_id: '1' },
    });
  });

  it('throws when plugin tools collide with base tools', () => {
    const bus = createBus<CoreEvent>();
    const provider: LLMProvider = async () => ({ content: 'ok' });
    const plugin: Plugin = {
      name: 'plugin',
      tools: {
        same: {
          name: 'same',
          description: 'Plugin tool',
          parameters: {},
          execute: () => 'plugin',
          onError: () => 'failed',
        },
      },
    };

    expect(() =>
      createRuntime({ session: newSession(),
        tools: {
          same: {
            name: 'same',
            description: 'Base tool',
            parameters: {},
            execute: () => 'base',
            onError: () => 'failed',
          },
        },
        plugins: [providerPlugin(provider), plugin],
        bus,
      })
    ).toThrow('Tool "same" from plugin "plugin" is already registered');
  });

  it('runs plugin lifecycle hooks in deterministic order', async () => {
    const order: string[] = [];
    const provider: LLMProvider = async () => ({ content: 'ok' });
    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      tools: {},
      plugins: [
        providerPlugin(provider),
        {
          name: 'first',
          hooks: {
            onStart: () => {
              order.push('start:first');
            },
            onStop: () => {
              order.push('stop:first');
            },
          },
        },
        {
          name: 'second',
          hooks: {
            onStart: () => {
              order.push('start:second');
            },
            onStop: () => {
              order.push('stop:second');
            },
          },
        },
      ],
      bus,
    });

    await runtime.start();
    await waitForAsync();
    await runtime.stop();
    await waitForAsync();

    expect(order).toEqual(['start:first', 'start:second', 'stop:second', 'stop:first']);
  });

  it('calls plugin onError hooks when runtime processing fails', async () => {
    const errors: unknown[] = [];
    const provider: LLMProvider = async () => ({
      tool_calls: [{ type: 'tool_call', id: '1', tool: 'missing', args: '{}' }],
    });
    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      tools: {},
      plugins: [providerPlugin(provider), { name: 'errors', hooks: { onError: (error) => errors.push(error) } }],
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Use missing tool' } });
    await waitForAsync();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('Unknown tool: missing');
  });

  it('throws when start() is called after stop()', async () => {
    const provider: LLMProvider = async () => ({ content: 'ok' });
    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(), plugins: [providerPlugin(provider)], tools: {}, bus });

    await runtime.start();
    await runtime.stop();

    await expect(runtime.start()).rejects.toThrow('Cannot start a stopped runtime');
  });

  it('resolves provider from a plugin', async () => {
    let called = false;
    const pluginProvider: LLMProvider = async () => {
      called = true;
      return { content: 'from plugin' };
    };
    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      tools: {},
      plugins: [{ name: 'my-provider', provider: pluginProvider }],
      bus,
    });

    const events: CoreEvent[] = [];
    bus.subscribe((e) => events.push(e));
    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'hi' } });
    await waitForAsync();

    expect(called).toBe(true);
    expect(events.some((e) => e.type === 'assistant_message')).toBe(true);
  });

  it('throws when no plugin provides a provider', () => {
    const bus = createBus<CoreEvent>();
    expect(() => createRuntime({ session: newSession(), tools: {}, bus })).toThrow('No provider configured');
  });

  it('emits assistant_start for non-streaming providers', async () => {
    const provider: LLMProvider = async () => ({ content: 'Hello!' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {},
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Hi' } });
    await waitForAsync();

    expect(events.some((event) => event.type === 'assistant_start')).toBe(true);
  });

  it('emits tool_call events for non-streaming providers', async () => {
    let callCount = 0;
    const provider: LLMProvider = async () => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '1 2' }] };
      }
      return { content: 'Done' };
    };
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        sum: {
          name: 'sum',
          description: 'Add',
          parameters: {},
          execute: () => '3',
          onError: () => 'failed',
        },
      },
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Calc' } });
    await waitForAsync();
    await waitForAsync();

    expect(events).toContainEqual({
      type: 'tool_call',
      call: { type: 'tool_call', id: '1', tool: 'sum', args: '1 2' },
    });
  });

  it('does not duplicate tool_call events when a streamed call also appears in done.response', async () => {
    const call = { type: 'tool_call' as const, id: '1', tool: 'sum', args: '1 2' };
    let callCount = 0;
    const provider: LLMProvider = async () => {
      callCount++;
      if (callCount === 1) {
        return (async function* () {
          yield { type: 'tool_call', call };
          yield { type: 'done', response: { tool_calls: [call] } };
        })();
      }
      return { content: 'Done' };
    };
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        sum: {
          name: 'sum',
          description: 'Add',
          parameters: {},
          execute: () => '3',
          onError: () => 'failed',
        },
      },
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Calc' } });
    await waitForAsync();
    await waitForAsync();

    expect(events.filter((event) => event.type === 'tool_call')).toHaveLength(1);
  });

  it('merges content and tool_calls into a single transcript entry for the next provider call', async () => {
    const providerMessages: Message[][] = [];
    let callCount = 0;
    const provider: LLMProvider = async (messages) => {
      callCount++;
      providerMessages.push(messages.map((m) => ({ ...m })));
      if (callCount === 1) {
        return {
          content: 'Reading file now',
          tool_calls: [{ type: 'tool_call', id: '1', tool: 'read', args: '{}' }],
        };
      }
      return { content: 'Done' };
    };
    const bus = createBus<CoreEvent>();
    const runtime = createRuntime({ session: newSession(),
      plugins: [providerPlugin(provider)],
      tools: {
        read: {
          name: 'read',
          description: 'Read a file',
          parameters: {},
          execute: () => 'file contents',
          onError: () => 'failed',
        },
      },
      bus,
    });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Read it' } });
    await waitForAsync();
    await waitForAsync();

    const secondCallTranscript = providerMessages[1];
    const assistantEntries = secondCallTranscript.filter((m) => m.role === 'assistant');

    expect(assistantEntries).toHaveLength(1);
    expect(assistantEntries[0].content).toBe('Reading file now');
    expect(assistantEntries[0].tool_calls).toEqual([
      { type: 'tool_call', id: '1', tool: 'read', args: '{}' },
    ]);
  });

  it('does not wipe queued messages when a turn fails', async () => {
    let callCount = 0;
    const provider: LLMProvider = async () => {
      callCount++;
      if (callCount <= 3) throw new Error(`boom ${callCount}`);
      return { content: 'finally worked' };
    };
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);
    const runtime = createRuntime({ session: newSession(), plugins: [providerPlugin(provider)], tools: {}, bus });

    await runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'one' } });
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'two' } });
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'three' } });
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'four' } });

    for (let i = 0; i < 10; i++) await waitForAsync();

    expect(events.filter((e) => e.type === 'error')).toHaveLength(3);
    expect(events).toContainEqual({
      type: 'assistant_message',
      message: { role: 'assistant', content: 'finally worked' },
    });
  });

  it('emits queue events when steering arrives while idle', async () => {
    const provider: LLMProvider = async () => ({ content: 'ok' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);
    const runtime = createRuntime({ session: newSession(), plugins: [providerPlugin(provider)], tools: {}, bus });

    await runtime.start();
    bus.publish({ type: 'steer', message: { role: 'user', content: 'while idle' } });
    await waitForAsync();

    expect(events).toContainEqual({
      type: 'queued_message',
      queue: 'steering',
      message: { role: 'user', content: 'while idle' },
    });
    expect(events.filter((e) => e.type === 'queue_update').length).toBeGreaterThan(0);
  });

  it('throws when multiple plugins provide a provider', () => {
    const p1: LLMProvider = async () => ({ content: '' });
    const p2: LLMProvider = async () => ({ content: '' });
    const bus = createBus<CoreEvent>();
    expect(() =>
      createRuntime({ session: newSession(),
        tools: {},
        plugins: [
          { name: 'a', provider: p1 },
          { name: 'b', provider: p2 },
        ],
        bus,
      })
    ).toThrow('Multiple plugins provide a provider');
  });
});
