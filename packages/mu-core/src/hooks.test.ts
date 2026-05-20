import { run } from './agenticLoop';
import type { Message } from './types/Message';
import type { ToolHooks } from './types/Hook';

describe('tool hooks', () => {
  it('should allow tool by default (no hooks)', async () => {
    const agent = (messages: Message[]) => {
      if (messages.length === 0) {
        return { type: 'tool_call', tool: 'sum', args: '1 2' };
      }
      return { type: 'response', content: 'Done' };
    };

    const tools = {
      sum: {
        name: 'sum',
        description: 'Add two numbers',
        parameters: {},
        execute: () => '3',
        onError: () => 'error',
      },
    };

    const stream = run(agent, tools);
    const messages: Message[] = [];
    for await (const msg of stream) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(3);
    expect(messages[1].content).toBe('3');
  });

  it('should block tool call with beforeTool hook', async () => {
    const agent = () => ({ type: 'tool_call', tool: 'sum', args: '1 2' });

    const tools = {
      sum: {
        name: 'sum',
        description: 'Add two numbers',
        parameters: {},
        execute: () => '3',
        onError: () => 'error',
      },
    };

    const hooks: ToolHooks = {
      beforeTool: async () => ({ block: true, reason: 'Blocked by hook' }),
    };

    const stream = run(agent, tools, hooks);
    await stream.next(); // yields assistant message
    await expect(stream.next()).rejects.toThrow('Blocked by hook');
  });

  it('should transform result with afterTool hook', async () => {
    const agent = (messages: Message[]) => {
      if (messages.length === 0) {
        return { type: 'tool_call', tool: 'sum', args: '1 2' };
      }
      return { type: 'response', content: 'Done' };
    };

    const tools = {
      sum: {
        name: 'sum',
        description: 'Add two numbers',
        parameters: {},
        execute: () => '3',
        onError: () => 'error',
      },
    };

    const hooks: ToolHooks = {
      afterTool: async () => ({ result: '999' }),
    };

    const stream = run(agent, tools, hooks);
    const messages: Message[] = [];
    for await (const msg of stream) {
      messages.push(msg);
    }

    expect(messages[1].content).toBe('999');
  });

  it('should run both beforeTool and afterTool hooks', async () => {
    const order: string[] = [];
    const agent = (messages: Message[]) => {
      if (messages.length === 0) {
        return { type: 'tool_call', tool: 'sum', args: '1 2' };
      }
      return { type: 'response', content: 'Done' };
    };

    const tools = {
      sum: {
        name: 'sum',
        description: 'Add two numbers',
        parameters: {},
        execute: () => '3',
        onError: () => 'error',
      },
    };

    const hooks: ToolHooks = {
      beforeTool: async () => {
        order.push('before');
      },
      afterTool: async () => {
        order.push('after');
      },
    };

    const stream = run(agent, tools, hooks);
    for await (const msg of stream) {
      // consume stream
    }

    expect(order).toEqual(['before', 'after']);
  });
});
