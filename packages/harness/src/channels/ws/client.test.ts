import { assertEquals, assertStringIncludes } from '@std/assert';
import { type ContentPart, image, type Message, type Provider } from 'mu-core';
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
  // The WS adapter drives the SHARED ChannelManager (not a private cache): the
  // live session is a real channel the manager knows about.
  assertEquals(channels.manager.get(session.id)?.id, session.id);
  assertEquals(channels.manager.list().length, 1);

  await remote.close();
  await channels.stop();
  harness.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test('connectHarness carries an image attachment through to the model (capability on)', async () => {
  const dir = await Deno.makeTempDir();
  const approvals = createApprovalManager();
  const seen: Message[][] = [];
  const capturing: Provider = {
    async *stream(req: { messages: Message[] }) {
      seen.push(req.messages);
      yield { type: 'text', text: 'ok' } as ContentPart;
    },
  };
  const harness = await createHarness({
    hostName: 'mu',
    xdg: { configHome: dir, dataHome: dir, stateHome: dir },
    providers: { local: capturing },
    model: 'local/m',
    title: false,
    approvals: { manager: approvals, activeAgent: () => undefined },
  });

  const channels = await runChannels({
    harness,
    approvals,
    adapters: [webSocketAdapter({ port: PORT + 2, capabilities: { vision: true } })],
  });
  const remote = await connectHarness({ url: `ws://127.0.0.1:${PORT + 2}`, cwd: dir });

  const session = remote.host.createSession();
  const done = new Promise<void>((resolve) => {
    session.subscribe((e) => e.type === 'turn_end' && resolve());
  });
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await session.send([{ type: 'text', text: 'look' }, image('image/png', bytes)]);
  await done;

  const userMsg = seen.at(-1)?.find((m) => m.role === 'user');
  const imgPart = userMsg?.content.find((p) => p.type === 'image');
  assertEquals(imgPart?.type === 'image' && imgPart.mime, 'image/png');
  assertEquals(imgPart?.type === 'image' ? [...imgPart.data] : [], [137, 80, 78, 71]);

  await remote.close();
  await channels.stop();
  harness.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test('connectHarness surfaces model_loading around a model switch (loads the model)', async () => {
  const dir = await Deno.makeTempDir();
  const approvals = createApprovalManager();
  const probed: string[] = [];
  const provider: Provider = {
    async *stream() {},
    capabilities(model: string) {
      probed.push(model);
      return Promise.resolve({ vision: true, audio: false });
    },
  };
  const harness = await createHarness({
    hostName: 'mu',
    xdg: { configHome: dir, dataHome: dir, stateHome: dir },
    providers: { local: provider },
    model: 'local/a',
    title: false,
    approvals: { manager: approvals, activeAgent: () => undefined },
  });

  const channels = await runChannels({ harness, approvals, adapters: [webSocketAdapter({ port: PORT + 3 })] });
  const remote = await connectHarness({ url: `ws://127.0.0.1:${PORT + 3}`, cwd: dir });

  const events: boolean[] = [];
  const done = new Promise<void>((resolve) => {
    remote.host.subscribeModelLoading?.((_model, loading) => {
      events.push(loading);
      if (!loading) resolve();
    });
  });
  remote.host.selectModel('local/b');
  await done;

  assertEquals(events, [true, false]); // loading start, then end
  assertEquals(probed, ['b']); // the new model was actually probed (loaded)

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

Deno.test('connectHarness transcribes voice over WebSocket via a configured voice model', async () => {
  const dir = await Deno.makeTempDir();
  const approvals = createApprovalManager();
  const harness = await createHarness({
    hostName: 'mu',
    xdg: { configHome: dir, dataHome: dir, stateHome: dir },
    providers: { local: scripted([[{ type: 'text', text: 'hello from audio' }]]) },
    model: 'local/m',
    voice: { model: 'voice-model' },
    title: false,
    approvals: { manager: approvals, activeAgent: () => undefined },
  });

  const channels = await runChannels({ harness, approvals, adapters: [webSocketAdapter({ port: PORT + 4 })] });
  const remote = await connectHarness({ url: `ws://127.0.0.1:${PORT + 4}`, cwd: dir });

  assertEquals(await remote.host.voice!.unavailableReason!(), undefined);
  const text = await remote.host.voice!.transcribe(new Uint8Array([1, 2, 3, 4]), 'audio/wav');
  assertEquals(text, 'hello from audio');

  await remote.close();
  await channels.stop();
  harness.close();
  await Deno.remove(dir, { recursive: true });
});
