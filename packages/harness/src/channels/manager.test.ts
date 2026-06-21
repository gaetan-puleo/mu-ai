import { expect, test } from 'vitest';
import type { ContentPart, Provider } from 'mu-core';
import { createAgentSession } from '../session';
import { createChannelManager } from './manager';

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++]) yield event;
    },
  };
};

test('open does not create a session, send creates it (lazy)', async () => {
  let created = 0;
  const manager = createChannelManager({
    createSession: () => {
      created++;
      return createAgentSession({ provider: scripted([[{ type: 'text', text: 'hi' }]]), model: 'mock' });
    },
  });

  const a = manager.open({ title: 'A' });
  manager.open({ title: 'B' });
  manager.open({ title: 'C' });
  expect(created).toEqual(0);
  expect(a.started).toEqual(false);

  await a.send('coucou');
  expect(created).toEqual(1);
  expect(a.started).toEqual(true);
  expect(a.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
});

test('a distinct session per channel', async () => {
  let created = 0;
  const manager = createChannelManager({
    createSession: () => {
      created++;
      return createAgentSession({ provider: scripted([[{ type: 'text', text: 'ok' }]]), model: 'mock' });
    },
  });

  const a = manager.open({ id: 'a' });
  const b = manager.open({ id: 'b' });

  await a.send('x');
  await b.send('y');

  expect(created).toEqual(2);
  expect(a.messages.length).toEqual(2);
  expect(b.messages.length).toEqual(2);
});

test('subscribe multiplexes events tagged by channelId', async () => {
  const manager = createChannelManager({
    createSession: () => createAgentSession({ provider: scripted([[{ type: 'text', text: 'ok' }]]), model: 'mock' }),
  });

  const events: string[] = [];
  manager.subscribe((event) => events.push(`${event.channelId}:${event.type}`));

  const a = manager.open({ id: 'a', title: 'A' });
  await a.send('x');

  expect(events[0]).toEqual('a:channel_open');
  expect(events.includes('a:turn_start')).toEqual(true);
  expect(events.includes('a:turn_end')).toEqual(true);
});

test('close removes the channel and emits channel_close', () => {
  const manager = createChannelManager({
    createSession: () => createAgentSession({ provider: scripted([[]]), model: 'mock' }),
  });
  const events: string[] = [];
  manager.subscribe((event) => events.push(event.type));

  const a = manager.open({ id: 'a' });
  expect(manager.list().length).toEqual(1);
  manager.close(a.id);
  expect(manager.get('a')).toEqual(undefined);
  expect(events.includes('channel_close')).toEqual(true);
});
