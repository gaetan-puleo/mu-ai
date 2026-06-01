import { assertEquals } from '@std/assert';
import type { Message } from 'mu-core';
import { convertMessages, convertTools } from './index';

Deno.test('convertMessages: tool_result becomes a tool role message', () => {
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'tool_result', id: 'c1', content: [{ type: 'text', text: 'ok' }] }] },
  ];
  assertEquals(convertMessages(messages), [{ role: 'tool', tool_call_id: 'c1', content: 'ok' }]);
});

Deno.test('convertMessages: assistant with tool_call', () => {
  const messages: Message[] = [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'je cherche' },
        { type: 'tool_call', id: 'c1', name: 'search', input: { q: 'mu' } },
      ],
    },
  ];
  assertEquals(convertMessages(messages), [
    {
      role: 'assistant',
      content: 'je cherche',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"mu"}' } }],
    },
  ]);
});

Deno.test('convertMessages: user multimodal text + image', () => {
  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'quoi ?' }, {
        type: 'image',
        mime: 'image/png',
        data: new Uint8Array([0, 1, 2]),
      }],
    },
  ];
  const out = convertMessages(messages);
  assertEquals(out, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'quoi ?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAEC' } },
      ],
    },
  ]);
});

Deno.test('convertMessages: user with text only stays a string', () => {
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'salut' }] }];
  assertEquals(convertMessages(messages), [{ role: 'user', content: 'salut' }]);
});

Deno.test('convertTools: Tool -> OpenAI function', () => {
  assertEquals(
    convertTools([{ name: 'search', description: 'cherche', parameters: { type: 'object' }, run: async () => [] }]),
    [{ type: 'function', function: { name: 'search', description: 'cherche', parameters: { type: 'object' } } }],
  );
});
