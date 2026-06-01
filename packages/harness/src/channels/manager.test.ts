import { assertEquals } from '@std/assert';
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

Deno.test('open does not create a session, send creates it (lazy)', async () => {
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
  assertEquals(created, 0);
  assertEquals(a.started, false);

  await a.send('coucou');
  assertEquals(created, 1);
  assertEquals(a.started, true);
  assertEquals(a.messages.at(-1), { role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
});

Deno.test('a distinct session per channel', async () => {
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

  assertEquals(created, 2);
  assertEquals(a.messages.length, 2);
  assertEquals(b.messages.length, 2);
});

Deno.test('subscribe multiplexes events tagged by channelId', async () => {
  const manager = createChannelManager({
    createSession: () => createAgentSession({ provider: scripted([[{ type: 'text', text: 'ok' }]]), model: 'mock' }),
  });

  const events: string[] = [];
  manager.subscribe((event) => events.push(`${event.channelId}:${event.type}`));

  const a = manager.open({ id: 'a', title: 'A' });
  await a.send('x');

  assertEquals(events[0], 'a:channel_open');
  assertEquals(events.includes('a:turn_start'), true);
  assertEquals(events.includes('a:turn_end'), true);
});

Deno.test('close removes the channel and emits channel_close', () => {
  const manager = createChannelManager({
    createSession: () => createAgentSession({ provider: scripted([[]]), model: 'mock' }),
  });
  const events: string[] = [];
  manager.subscribe((event) => events.push(event.type));

  const a = manager.open({ id: 'a' });
  assertEquals(manager.list().length, 1);
  manager.close(a.id);
  assertEquals(manager.get('a'), undefined);
  assertEquals(events.includes('channel_close'), true);
});
