import { assertEquals, assertStringIncludes } from '@std/assert';
import type { ContentPart, Provider } from 'mu-core';
import { createHarness } from '../../harness/create';
import { createApprovalManager } from '../../permissions';
import { runChannels } from '../adapter';
import { webSocketAdapter } from './server';
import { connectHarness } from './client';

const scripted = (turns: ContentPart[][]): Provider => {
  let i = 0;
  return {
    async *stream() {
      for (const event of turns[i++] ?? []) yield event;
    },
  };
};

const PORT = 38971;

Deno.test('connectHarness drives a remote session end-to-end over WebSocket', async () => {
  const dir = await Deno.makeTempDir();
  const approvals = createApprovalManager();
  const harness = await createHarness({
    hostName: 'mu',
    xdg: { configHome: dir, dataHome: dir, stateHome: dir },
    providers: { local: scripted([[{ type: 'text', text: 'bonjour' }]]) },
    model: 'local/m',
    title: false,
    approvals: { manager: approvals, activeAgent: () => undefined },
  });

  const channels = await runChannels({ harness, approvals, adapters: [webSocketAdapter({ port: PORT })] });
  const remote = await connectHarness({ url: `ws://127.0.0.1:${PORT}`, cwd: dir });

  const session = remote.host.createSession();
  let text = '';
  const done = new Promise<void>((resolve) => {
    session.subscribe((e) => {
      if (e.type === 'text') text += e.text;
      if (e.type === 'turn_end') resolve();
    });
  });
  await session.send('hi');
  await done;

  assertStringIncludes(text, 'bonjour');

  await remote.close();
  await channels.stop();
  harness.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test('connectHarness lists sessions created remotely', async () => {
  const dir = await Deno.makeTempDir();
  const approvals = createApprovalManager();
  const harness = await createHarness({
    hostName: 'mu',
    xdg: { configHome: dir, dataHome: dir, stateHome: dir },
    providers: { local: scripted([[{ type: 'text', text: 'ok' }]]) },
    model: 'local/m',
    title: false,
    approvals: { manager: approvals, activeAgent: () => undefined },
  });

  const channels = await runChannels({ harness, approvals, adapters: [webSocketAdapter({ port: PORT + 1 })] });
  const remote = await connectHarness({ url: `ws://127.0.0.1:${PORT + 1}`, cwd: dir });

  const session = remote.host.createSession();
  const done = new Promise<void>((resolve) => {
    session.subscribe((e) => e.type === 'turn_end' && resolve());
  });
  await session.send('hi');
  await done;

  const sessions = await remote.host.listSessions();
  assertEquals(sessions.some((s) => s.id === session.id), true);

  await remote.close();
  await channels.stop();
  harness.close();
  await Deno.remove(dir, { recursive: true });
});
