import { createBus } from './bus';
import { createRuntime } from './runtime';
import type { CoreEvent } from './runtime';
import type { LLMProvider } from './provider';
import type { ToolHooks } from './types/Hook';

function collectEvents(bus: ReturnType<typeof createBus<CoreEvent>>): CoreEvent[] {
  const events: CoreEvent[] = [];
  bus.subscribe(event => events.push(event));
  return events;
}

function waitForAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('tool hooks', () => {
  it('should allow tool by default (no hooks)', async () => {
    let callCount = 0;
    const provider: LLMProvider = async (messages) => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '1 2' }] };
      }
      return { content: 'Done' };
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
          execute: () => '3',
          onError: () => 'error',
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

    expect(events.filter(e => e.type === 'tool_result')).toHaveLength(1);
    expect(events.find(e => e.type === 'tool_result')?.message?.content).toBe('3');
  });

  it('should block tool call with beforeTool hook', async () => {
    const provider: LLMProvider = async () => ({
      tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '1 2' }],
    });

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const hooks: ToolHooks = {
      beforeTool: async () => ({ block: true, reason: 'Blocked by hook' }),
    };

    const runtime = createRuntime({
      provider,
      tools: {
        sum: {
          name: 'sum',
          description: 'Add two numbers',
          parameters: {},
          execute: () => '3',
          onError: () => 'error',
        },
      },
      bus,
      hooks,
    });

    runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();

    expect(events.some(event =>
      event.type === 'error' &&
      event.error instanceof Error &&
      event.error.message === 'Blocked by hook'
    )).toBe(true);
  });

  it('should transform result with afterTool hook', async () => {
    let callCount = 0;
    const provider: LLMProvider = async (messages) => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '1 2' }] };
      }
      return { content: 'Done' };
    };

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const hooks: ToolHooks = {
      afterTool: async () => ({ result: '999' }),
    };

    const runtime = createRuntime({
      provider,
      tools: {
        sum: {
          name: 'sum',
          description: 'Add two numbers',
          parameters: {},
          execute: () => '3',
          onError: () => 'error',
        },
      },
      bus,
      hooks,
    });

    runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(events.find(e => e.type === 'tool_result')?.message?.content).toBe('999');
  });

  it('should run both beforeTool and afterTool hooks', async () => {
    const order: string[] = [];
    let callCount = 0;
    const provider: LLMProvider = async (messages) => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '1 2' }] };
      }
      return { content: 'Done' };
    };

    const bus = createBus<CoreEvent>();

    const hooks: ToolHooks = {
      beforeTool: async () => {
        order.push('before');
      },
      afterTool: async () => {
        order.push('after');
      },
    };

    const runtime = createRuntime({
      provider,
      tools: {
        sum: {
          name: 'sum',
          description: 'Add two numbers',
          parameters: {},
          execute: () => '3',
          onError: () => 'error',
        },
      },
      bus,
      hooks,
    });

    runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(order).toEqual(['before', 'after']);
  });
});
