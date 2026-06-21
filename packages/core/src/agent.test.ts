import { expect, test } from 'vitest';
import { createAgent } from './agent';
import { image } from './types';
import type { ContentPart, Message, Provider, Tool } from './types';

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++]) yield event;
    },
  };
};

test('loops on a tool_call and returns the final message', async () => {
  const provider = scripted([
    [{ type: 'tool_call', id: '1', name: 'snap', input: {} }],
    [{ type: 'text', text: 'voici' }],
  ]);

  const snap: Tool = {
    name: 'snap',
    description: 'returns an image',
    parameters: {},
    run: async () => [image('image/png', new Uint8Array([1, 2, 3]))],
  };

  const agent = createAgent({ provider, model: 'mock', tools: [snap] });
  const { message, messages } = await agent.run('photo ?');

  expect(message.content).toEqual([{ type: 'text', text: 'voici' }]);
  const tool = messages.find((m) => m.role === 'tool' && m.content[0]?.type === 'tool_result');
  expect(tool?.content[0]).toEqual({
    type: 'tool_result',
    id: '1',
    content: [{ type: 'image', mime: 'image/png', data: new Uint8Array([1, 2, 3]) }],
  });
});

test('merges streamed text deltas', async () => {
  const provider = scripted([[{ type: 'text', text: 'bon' }, { type: 'text', text: 'jour' }]]);
  const agent = createAgent({ provider, model: 'mock' });
  const { message } = await agent.run('salut');
  expect(message.content).toEqual([{ type: 'text', text: 'bonjour' }]);
});

test('yields an error event when the provider throws', async () => {
  const provider = {
    async *stream() {
      throw new Error('provider failed');
    },
  };
  const agent = createAgent({ provider, model: 'mock' });
  const events: unknown[] = [];
  for await (const event of agent.stream('hello')) {
    events.push(event);
  }
  const doneEvent = events.at(-1) as { type: 'done'; messages: Message[] };
  expect(doneEvent.type).toEqual('done');
  expect(doneEvent.messages.length).toEqual(1);
  expect(doneEvent.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
  const errorEvent = events.find((e) => (e as { type: string }).type === 'error');
  expect((errorEvent as { type: 'error'; error: Error }).error.message).toEqual('provider failed');
});

test('aborts cleanly when the signal is already aborted', async () => {
  const provider: Provider = {
    async *stream() {
      yield { type: 'text', text: 'should not reach' };
    },
  };
  const controller = new AbortController();
  controller.abort();
  const agent = createAgent({ provider, model: 'mock', signal: controller.signal });
  const events: unknown[] = [];
  for await (const event of agent.stream('hello')) {
    events.push(event);
  }
  const doneEvent = events.at(-1) as { type: 'done'; messages: Message[] };
  expect(doneEvent.type).toEqual('done');
  expect(doneEvent.messages.length).toEqual(1);
  expect(doneEvent.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
});
