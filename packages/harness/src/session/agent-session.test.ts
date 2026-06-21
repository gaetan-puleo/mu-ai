import { expect, test } from 'vitest';
import type { ContentPart, Message, Provider, Tool } from 'mu-core';
import { definePlugin } from '../plugin';
import { createAgentSession } from './agent-session';
import type { AgentSessionEvent } from './types';

test('prepareRequest filters the tools schema and rewrites the system seen by the provider', async () => {
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

  expect(seenTools).toEqual(['read']);
  expect(seenSystem).toEqual('base [no bash]');
  const stored = session.messages.find((m: Message) => m.role === 'system');
  expect(stored?.content[0]).toEqual({ type: 'text', text: 'base' });

  // assembleRequest must reflect what the MODEL sees (hook-rewritten), not the stored system —
  // this is what /context and /context-export read so they tell the truth.
  const req = await session.assembleRequest!();
  expect(req.system).toEqual('base [no bash]');
  expect(req.tools.map((t) => t.name)).toEqual(['read']);
  expect(req.messages[0]?.role === 'system' && req.messages[0].content[0]).toEqual({ type: 'text', text: 'base [no bash]' });
});

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++]) yield event;
    },
  };
};

test('a plugin provides provider + tool + hook that denies, full chain', async () => {
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

  expect(toolRan).toEqual(false);
  expect(lifecycle).toEqual(['start']);

  const types = events.map((e) => e.type);
  expect(types[0]).toEqual('turn_start');
  expect(types[types.length - 1]).toEqual('turn_end');

  const toolResult = session.messages.find((m) => m.role === 'tool' && m.content[0]?.type === 'tool_result');
  expect(toolResult?.content[0]).toEqual({
    type: 'tool_result',
    id: '1',
    content: [{ type: 'text', text: 'denied' }],
  });

  const last = session.messages[session.messages.length - 1];
  expect(last).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'fini' }] });
});

test('send is refused while a turn is already in progress', async () => {
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
  expect(rejected).toEqual(true);
});
