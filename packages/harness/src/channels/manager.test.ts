import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createChannelManager } from './manager';
import type { Channel, ChannelOutEvent } from './types';

function makeChannel(id: string): { channel: Channel; received: ChannelOutEvent[]; started: boolean; stopped: boolean } {
  const received: ChannelOutEvent[] = [];
  const state = { started: false, stopped: false };
  const channel: Channel = {
    id,
    kind: 'test',
    start() {
      state.started = true;
    },
    stop() {
      state.stopped = true;
    },
    send(event) {
      received.push(event);
    },
  };
  return { channel, received, get started() { return state.started; }, get stopped() { return state.stopped; } };
}

describe('createChannelManager', () => {
  it('starts channels on add', async () => {
    const mgr = createChannelManager();
    const a = makeChannel('a');
    await mgr.add(a.channel);
    expect(a.started).toBe(true);
  });

  it('rejects duplicate ids', async () => {
    const mgr = createChannelManager();
    const a = makeChannel('a');
    await mgr.add(a.channel);
    const b = makeChannel('a');
    await expect(mgr.add(b.channel)).rejects.toThrow();
  });

  it('broadcasts events to every channel', async () => {
    const mgr = createChannelManager();
    const a = makeChannel('a');
    const b = makeChannel('b');
    await mgr.add(a.channel);
    await mgr.add(b.channel);
    await mgr.broadcast({ type: 'assistant_start' });
    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
  });

  it('routes single send to one channel', async () => {
    const mgr = createChannelManager();
    const a = makeChannel('a');
    const b = makeChannel('b');
    await mgr.add(a.channel);
    await mgr.add(b.channel);
    await mgr.send('a', { type: 'assistant_start' });
    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(0);
  });

  it('delivers input events to listeners with the channel id', async () => {
    const mgr = createChannelManager();
    const seen: Array<{ id: string; type: string }> = [];
    mgr.onInput((id, ev) => {
      seen.push({ id, type: ev.type });
    });
    const ctxs: Array<{ deliver: (e: { type: 'user_input'; text: string }) => void | Promise<void> }> = [];
    const channel: Channel = {
      id: 'a',
      kind: 'test',
      start(ctx) {
        ctxs.push({ deliver: ctx.deliver });
      },
      stop() {},
      send() {},
    };
    await mgr.add(channel);
    await ctxs[0].deliver({ type: 'user_input', text: 'hi' });
    expect(seen).toEqual([{ id: 'a', type: 'user_input' }]);
  });

  it('stopAll stops every channel', async () => {
    const mgr = createChannelManager();
    const a = makeChannel('a');
    const b = makeChannel('b');
    await mgr.add(a.channel);
    await mgr.add(b.channel);
    await mgr.stopAll();
    expect(a.stopped).toBe(true);
    expect(b.stopped).toBe(true);
    expect(mgr.list()).toHaveLength(0);
  });
});
