import { assertEquals } from '@std/assert';
import type { ContentPart, Message, Provider, Tool } from 'mu-core';
import { definePlugin } from '../plugin';
import { createAgentSession } from './agent-session';
import type { AgentSessionEvent } from './types';

Deno.test('prepareRequest filters the tools schema and rewrites the system seen by the provider', async () => {
  let seenTools: string[] = [];
  let seenSystem = '';
  const provider: Provider = {
    async *stream(req) {
      seenTools = req.tools.map((t) => t.name);
      seenSystem = req.messages[0]?.role === 'system'
        ? req.messages[0].content.map((p) => (p.type === 'text' ? p.text : '')).join('')
        : '';
      yield { type: 'text', text: 'ok' };
    },
  };
  const tool = (name: string): Tool => ({ name, description: '', parameters: {}, run: async () => [] });

  const session = createAgentSession({
    provider,
    model: 'mock',
    system: 'base',
    tools: [tool('read'), tool('bash')],
    hooks: {
      prepareRequest: ({ system, tools }) => ({
        system: `${system} [no bash]`,
        tools: tools.filter((t) => t.name !== 'bash'),
      }),
    },
  });

  await session.send('go');

  assertEquals(seenTools, ['read']);
  assertEquals(seenSystem, 'base [no bash]');
  const stored = session.messages.find((m: Message) => m.role === 'system');
  assertEquals(stored?.content[0], { type: 'text', text: 'base' });

  // lastRequest must reflect what the MODEL saw (hook-rewritten), not the stored system —
  // this is what /context-export now reads so the export tells the truth.
  assertEquals(session.lastRequest?.system, 'base [no bash]');
  assertEquals(session.lastRequest?.tools.map((t) => t.name), ['read']);
  const sentSystem = session.lastRequest?.messages[0];
  assertEquals(sentSystem?.role === 'system' && sentSystem.content[0], { type: 'text', text: 'base [no bash]' });
});

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++]) yield event;
    },
  };
};

Deno.test('a plugin provides provider + tool + hook that denies, full chain', async () => {
  let toolRan = false;
  const lifecycle: string[] = [];

  const provider = scripted([
    [{ type: 'tool_call', id: '1', name: 'danger', input: {} }],
    [{ type: 'text', text: 'fini' }],
  ]);

  const plugin = definePlugin({
    name: 'demo',
    tools: [{
      name: 'danger',
      description: '',
      parameters: {},
      run: async () => {
        toolRan = true;
        return [{ type: 'text', text: 'executed' }];
      },
    }],
    hooks: {
      sessionStart: () => {
        lifecycle.push('start');
      },
      beforeToolCall: () => [{ type: 'text', text: 'denied' }],
    },
  });

  const session = createAgentSession({ provider, model: 'mock', plugins: [plugin] });

  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));

  await session.send('vas-y');

  assertEquals(toolRan, false);
  assertEquals(lifecycle, ['start']);

  const types = events.map((e) => e.type);
  assertEquals(types[0], 'turn_start');
  assertEquals(types[types.length - 1], 'turn_end');

  const toolResult = session.messages.find((m) => m.role === 'tool' && m.content[0]?.type === 'tool_result');
  assertEquals(toolResult?.content[0], {
    type: 'tool_result',
    id: '1',
    content: [{ type: 'text', text: 'denied' }],
  });

  const last = session.messages[session.messages.length - 1];
  assertEquals(last, { role: 'assistant', content: [{ type: 'text', text: 'fini' }] });
});

Deno.test('send is refused while a turn is already in progress', async () => {
  const session = createAgentSession({
    model: 'mock',
    provider: scripted([[{ type: 'text', text: 'ok' }]]),
  });

  const first = session.send('un');
  let rejected = false;
  try {
    await session.send('deux');
  } catch {
    rejected = true;
  }
  await first;
  assertEquals(rejected, true);
});
