import { run } from './agenticLoop';
import type { Message } from './types/Message';

describe('agentic loop', () => {
  it('should yield agent response immediately when no tools are needed', async () => {
    const agent = () => ({ type: 'response', content: 'Hello!' });
    const tools = {};

    const stream = run(agent, tools);
    const messages: Message[] = [];
    for await (const msg of stream) {
      messages.push(msg);
    }

    expect(messages).toEqual([{ role: 'assistant', content: 'Hello!' }]);
  });

  it('should call tool and stream the result', async () => {
    const agent = (messages) => {
      if (messages.length === 0) {
        return { type: 'tool_call', tool: 'sum', args: '2 3' };
      }
      return { type: 'response', content: `Result: ${messages[messages.length - 1].content}` };
    };

    const tools = {
      sum: {
        name: 'sum',
        description: 'Add two numbers',
        parameters: {},
        execute: (args: string) => {
          const [a, b] = args.split(' ').map(Number);
          return `${a + b}`;
        },
        onError: () => 'sum failed',
      },
    };

    const stream = run(agent, tools);
    const messages: Message[] = [];
    for await (const msg of stream) {
      messages.push(msg);
    }

    expect(messages).toEqual([
      { role: 'assistant', content: expect.anything() },
      { role: 'tool', content: '5', tool_id: expect.any(String) },
      { role: 'assistant', content: 'Result: 5' },
    ]);
  });

  it('should handle multiple tool calls before responding', async () => {
    const agent = (messages) => {
      const toolResults = messages.filter((m) => m.role === 'tool');
      if (toolResults.length === 0) {
        return { type: 'tool_call', tool: 'add', args: '1 2' };
      } else if (toolResults.length === 1) {
        return { type: 'tool_call', tool: 'multiply', args: '3 4' };
      }
      return { type: 'response', content: 'Done' };
    };

    const tools = {
      add: {
        name: 'add',
        description: 'Add two numbers',
        parameters: {},
        execute: (args: string) => {
          const [a, b] = args.split(' ').map(Number);
          return `${a + b}`;
        },
        onError: () => 'add failed',
      },
      multiply: {
        name: 'multiply',
        description: 'Multiply two numbers',
        parameters: {},
        execute: (args: string) => {
          const [a, b] = args.split(' ').map(Number);
          return `${a * b}`;
        },
        onError: () => 'multiply failed',
      },
    };

    const stream = run(agent, tools);
    const messages: Message[] = [];
    for await (const msg of stream) {
      messages.push(msg);
    }

    expect(messages).toEqual([
      { role: 'assistant', content: expect.anything() },
      { role: 'tool', content: '3', tool_id: expect.any(String) },
      { role: 'assistant', content: expect.anything() },
      { role: 'tool', content: '12', tool_id: expect.any(String) },
      { role: 'assistant', content: 'Done' },
    ]);
  });

  it('should throw error for unknown tool', async () => {
    const agent = () => ({ type: 'tool_call', tool: 'unknown', args: '{}' });
    const tools = {};

    const stream = run(agent, tools);
    await stream.next(); // yields assistant message
    await expect(stream.next()).rejects.toThrow('Unknown tool: unknown');
  });
});
