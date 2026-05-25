import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createBus } from './bus';
import type { LLMProvider } from './provider';
import type { CoreEvent } from './runtime';
import { createRuntime } from './runtime';
import type { ToolHooks } from './types/Hook';

function collectEvents(bus: ReturnType<typeof createBus<CoreEvent>>): CoreEvent[] {
  const events: CoreEvent[] = [];
  bus.subscribe((event) => events.push(event));
  return events;
}

function waitForAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('tool hooks', () => {
  it('should allow tool by default (no hooks)', async () => {
    let callCount = 0;
    const provider: LLMProvider = async (_messages) => {
      callCount++;
      if (callCount === 1) {
        return { tool_calls: [{ type: 'tool_call', id: '1', tool: 'sum', args: '1 2' }] };
      }
      return { content: 'Done' };
    };

    const bus = createBus<CoreEvent>();
    const events = collectEvents(bus);

    const runtime = createRuntime({
      plugins: [{ name: 'test-provider', provider }],
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

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(1);
    expect(events.find((e) => e.type === 'tool_result')?.message?.content).toBe('3');
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
      plugins: [{ name: 'test-provider', provider }],
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

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();

    expect(
      events.some(
        (event) => event.type === 'tool_result' && event.message?.content === 'Blocked: Blocked by hook',
      ),
    ).toBe(true);
  });

  it('should transform result with afterTool hook', async () => {
    let callCount = 0;
    const provider: LLMProvider = async (_messages) => {
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
      plugins: [{ name: 'test-provider', provider }],
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

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(events.find((e) => e.type === 'tool_result')?.message?.content).toBe('999');
  });

  it('should run both beforeTool and afterTool hooks', async () => {
    const order: string[] = [];
    let callCount = 0;
    const provider: LLMProvider = async (_messages) => {
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
        return undefined;
      },
      afterTool: async () => {
        order.push('after');
        return undefined;
      },
    };

    const runtime = createRuntime({
      plugins: [{ name: 'test-provider', provider }],
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

    await runtime.start();

    bus.publish({
      type: 'user_message',
      message: { role: 'user', content: 'Calculate' },
    });

    await waitForAsync();
    await waitForAsync();

    expect(order).toEqual(['before', 'after']);
  });
});
