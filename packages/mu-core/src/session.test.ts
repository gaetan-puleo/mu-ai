import { describe, expect, it } from 'bun:test';
import { PluginRegistry } from './registry';
import { createSessionManager } from './session';
import type { ProviderConfig } from './types/llm';

const cfg: ProviderConfig = {
  baseUrl: 'http://localhost:0',
  maxTokens: 1,
  temperature: 0,
  streamTimeoutMs: 1,
};

function newSm() {
  const registry = new PluginRegistry({ cwd: '/tmp', config: {} });
  return { registry, sm: createSessionManager({ registry, config: cfg, model: 'test' }) };
}

describe('SessionManager basics', () => {
  it('lazily creates sessions per key', () => {
    const { sm } = newSm();
    const a = sm.getOrCreate('one');
    const b = sm.getOrCreate('one');
    const c = sm.getOrCreate('two');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(sm.list()).toHaveLength(2);
  });

  it('getOrCreate honours initialMessages', () => {
    const { sm } = newSm();
    const s = sm.getOrCreate('x', { initialMessages: [{ role: 'user', content: 'seed' }] });
    expect(s.getMessages()).toEqual([{ role: 'user', content: 'seed' }]);
  });

  it('close removes session', async () => {
    const { sm } = newSm();
    sm.getOrCreate('x');
    await sm.close('x');
    expect(sm.get('x')).toBeUndefined();
  });
});

describe('Session message store', () => {
  it('appendSynthetic emits messages_changed', () => {
    const { sm } = newSm();
    const s = sm.getOrCreate('x');
    const events: number[] = [];
    s.subscribe((e) => {
      if (e.type === 'messages_changed') events.push(e.messages.length);
    });
    s.appendSynthetic({ role: 'assistant', content: 'banner' });
    expect(events).toEqual([1]);
  });

  it('queueForNextTurn does not appear in getMessages', () => {
    const { sm } = newSm();
    const s = sm.getOrCreate('x');
    s.queueForNextTurn({ role: 'system', content: 'inject' });
    expect(s.getMessages()).toEqual([]);
  });

  it('setMessages replaces transcript and emits', () => {
    const { sm } = newSm();
    const s = sm.getOrCreate('x');
    let last: number | null = null;
    s.subscribe((e) => {
      if (e.type === 'messages_changed') last = e.messages.length;
    });
    s.setMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(s.getMessages()).toHaveLength(2);
    expect(last).toBe(2);
  });

  it('subscribe / unsubscribe', () => {
    const { sm } = newSm();
    const s = sm.getOrCreate('x');
    const seen: string[] = [];
    const off = s.subscribe(() => seen.push('hit'));
    s.appendSynthetic({ role: 'assistant', content: 'a' });
    off();
    s.appendSynthetic({ role: 'assistant', content: 'b' });
    // messages_changed + synthetic_appended = 2 hits before unsubscribe
    expect(seen).toHaveLength(2);
  });
});

describe('Session.runTurn re-entrance guard', () => {
  it('rejects concurrent runTurn calls', async () => {
    const { sm } = newSm();
    const s = sm.getOrCreate('x');
    const first = s.runTurn({ userMessage: { role: 'user', content: 'hi' } });
    await expect(s.runTurn({ userMessage: { role: 'user', content: 'bye' } })).rejects.toThrow(
      /already running a turn/i,
    );
    await first;
  });
});

describe('SessionManager.onSessionCreated', () => {
  it('fires for newly created sessions', () => {
    const { sm } = newSm();
    const seen: string[] = [];
    sm.onSessionCreated((s) => seen.push(s.id));
    sm.getOrCreate('a');
    sm.getOrCreate('b');
    expect(seen).toEqual(['a', 'b']);
  });

  it('replays existing sessions to late subscribers', () => {
    const { sm } = newSm();
    sm.getOrCreate('a');
    sm.getOrCreate('b');
    const seen: string[] = [];
    sm.onSessionCreated((s) => seen.push(s.id));
    expect(seen).toEqual(['a', 'b']);
  });

  it('does NOT re-fire on getOrCreate of an existing session', () => {
    const { sm } = newSm();
    const seen: string[] = [];
    sm.onSessionCreated((s) => seen.push(s.id));
    sm.getOrCreate('a');
    sm.getOrCreate('a');
    sm.getOrCreate('a');
    expect(seen).toEqual(['a']);
  });

  it('unsubscribes correctly', () => {
    const { sm } = newSm();
    const seen: string[] = [];
    const off = sm.onSessionCreated((s) => seen.push(s.id));
    sm.getOrCreate('a');
    off();
    sm.getOrCreate('b');
    expect(seen).toEqual(['a']);
  });
});
