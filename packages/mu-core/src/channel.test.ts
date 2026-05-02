import { describe, expect, it } from 'bun:test';
import { type Channel, createChannelRegistry } from './channel';

function makeChannel(id: string, started: { value: boolean }): Channel {
  return {
    id,
    async start() {
      started.value = true;
    },
    async stop() {
      started.value = false;
    },
  };
}

describe('ChannelRegistry', () => {
  it('registers, lists, gets', () => {
    const r = createChannelRegistry();
    const flag = { value: false };
    r.register(makeChannel('tui', flag));
    expect(r.list().map((c) => c.id)).toEqual(['tui']);
    expect(r.get('tui')?.id).toBe('tui');
    expect(r.get('missing')).toBeUndefined();
  });

  it('rejects duplicate id', () => {
    const r = createChannelRegistry();
    r.register(makeChannel('a', { value: false }));
    expect(() => r.register(makeChannel('a', { value: false }))).toThrow();
  });

  it('startAll / stopAll', async () => {
    const r = createChannelRegistry();
    const f1 = { value: false };
    const f2 = { value: false };
    r.register(makeChannel('a', f1));
    r.register(makeChannel('b', f2));
    await r.startAll();
    expect(f1.value).toBe(true);
    expect(f2.value).toBe(true);
    await r.stopAll();
    expect(f1.value).toBe(false);
    expect(f2.value).toBe(false);
  });

  it('unregister callback removes', () => {
    const r = createChannelRegistry();
    const off = r.register(makeChannel('a', { value: false }));
    off();
    expect(r.list()).toEqual([]);
  });
});
