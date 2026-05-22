import { createBus } from './bus';
import type { LLMProvider } from './provider';
import type { CoreEvent } from './runtime';
import { createRuntime } from './runtime';

function collectEvents(bus: ReturnType<typeof createBus<CoreEvent>>): CoreEvent[] {
  const events: CoreEvent[] = [];
  bus.subscribe((event) => events.push(event));
  return events;
}

function waitForAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createRuntime', () => {
  it('reacts to a user message and publishes assistant response', async () => {
    const provider: LLMProvider = async () => ({ content: 'Hello!' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

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

    const runtime = createRuntime({
      provider,
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

    runtime.start();

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

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

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
      reasoning: 'Thinking...',
      content: 'The answer is 42',
    });

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

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

  it('publishes context updates from provider responses', async () => {
    const context = {
      usage: { promptTokens: 1234, completionTokens: 56, totalTokens: 1290 },
      props: { n_ctx: 32000, total_slots: 4, model_path: 'model.gguf', model_alias: 'model' },
      currentSlot: { id: 0, n_ctx: 32000, is_processing: false },
    };
    const provider: LLMProvider = async () => ({ content: 'Hello!', context });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    expect(events).toContainEqual({
      type: 'context_update',
      context,
    });
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

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

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
  });

  it('queues multiple user messages', async () => {
    const provider: LLMProvider = async () => ({ content: 'Response' });
    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

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
    const runtime = createRuntime({
      provider,
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

    runtime.start();
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
    const runtime = createRuntime({ provider, tools: {}, bus });

    runtime.start();
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'Start' } });
    await waitForAsync();

    bus.publish({ type: 'follow_up', message: { role: 'user', content: 'After that' } });
    resolveFirstProvider?.();
    await waitForAsync();
    await waitForAsync();

    expect(providerMessages[0]).toEqual(['user:Start']);
    expect(providerMessages[1]).toContain('assistant:First done');
    expect(providerMessages[1]).toContain('user:After that');
    expect(events).toContainEqual({ type: 'assistant_message', message: { role: 'assistant', content: 'Follow-up done' } });
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
    const runtime = createRuntime({
      provider,
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

    runtime.start();
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
    const runtime = createRuntime({
      provider,
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

    runtime.start();
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

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    runtime.stop();

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

    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    expect(runtime.state()).toBe('idle');

    runtime.start();

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
    const runtime = createRuntime({
      provider,
      tools: {},
      bus,
    });

    runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Hi' },
    });

    await waitForAsync();

    expect(runtime.state()).toBe('running');

    resolveProvider?.();
    await waitForAsync();
  });
});
