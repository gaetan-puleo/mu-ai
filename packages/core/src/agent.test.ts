import { assertEquals } from '@std/assert';
import { createAgent } from './agent';
import { image } from './types';
import type { ContentPart, Provider, Tool } from './types';

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++]) yield event;
    },
  };
};

Deno.test('loops on a tool_call and returns the final message', async () => {
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

  assertEquals(message.content, [{ type: 'text', text: 'voici' }]);
  const tool = messages.find((m) => m.role === 'user' && m.content[0]?.type === 'tool_result');
  assertEquals(tool?.content[0], {
    type: 'tool_result',
    id: '1',
    content: [{ type: 'image', mime: 'image/png', data: new Uint8Array([1, 2, 3]) }],
  });
});

Deno.test('merges streamed text deltas', async () => {
  const provider = scripted([[{ type: 'text', text: 'bon' }, { type: 'text', text: 'jour' }]]);
  const agent = createAgent({ provider, model: 'mock' });
  const { message } = await agent.run('salut');
  assertEquals(message.content, [{ type: 'text', text: 'bonjour' }]);
});
