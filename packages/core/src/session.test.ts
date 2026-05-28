import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createInMemorySessionStore, type SessionStoreEvent } from './session';
import type { Message } from './types/Message';

function fixedTimeStore() {
  let t = 1_000;
  return createInMemorySessionStore({
    idGen: () => `s_${t}`,
    now: () => t++,
  });
}

describe('createInMemorySessionStore', () => {
  it('creates a session with empty arrays and matching timestamps', () => {
    const store = fixedTimeStore();
    const s = store.create();
    expect(s.messages).toEqual([]);
    expect(s.createdAt).toBe(s.updatedAt);
  });

  it('seeds messages and title from init', () => {
    const store = createInMemorySessionStore();
    const msgs: Message[] = [{ role: 'user', content: 'hi' }];
    const s = store.create({ title: 'demo', messages: msgs });
    expect(s.title).toBe('demo');
    expect(s.messages).toEqual(msgs);
    expect(s.messages).not.toBe(msgs); // defensive copy
  });

  it('lists every session created so far', () => {
    const store = createInMemorySessionStore();
    const a = store.create();
    const b = store.create();
    expect(store.list().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('emits "created" on create and "deleted" on delete', () => {
    const store = createInMemorySessionStore();
    const seen: SessionStoreEvent[] = [];
    store.subscribe((e) => seen.push(e));
    const s = store.create();
    store.delete(s.id);
    expect(seen.map((e) => e.type)).toEqual(['created', 'deleted']);
  });

  it('touch bumps updatedAt and emits "updated"', () => {
    const store = fixedTimeStore();
    const s = store.create();
    const before = s.updatedAt;
    const seen: SessionStoreEvent[] = [];
    store.subscribe((e) => seen.push(e));
    store.touch(s.id);
    expect(s.updatedAt).toBeGreaterThan(before);
    expect(seen).toEqual([{ type: 'updated', session: s }]);
  });

  it('touch on a missing id is a no-op', () => {
    const store = createInMemorySessionStore();
    const seen: SessionStoreEvent[] = [];
    store.subscribe((e) => seen.push(e));
    store.touch('nope');
    expect(seen).toEqual([]);
  });

  it('delete on a missing id is a no-op', () => {
    const store = createInMemorySessionStore();
    const seen: SessionStoreEvent[] = [];
    store.subscribe((e) => seen.push(e));
    store.delete('nope');
    expect(seen).toEqual([]);
  });

  it('fork copies messages 0..atIndex inclusive and records the source', () => {
    const store = createInMemorySessionStore();
    const source = store.create({
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ],
    });
    const fork = store.fork(source.id, 2);
    expect(fork.messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2']);
    expect(fork.forkedFrom).toEqual({ sessionId: source.id, atIndex: 2 });
    expect(fork.id).not.toBe(source.id);
    // source untouched
    expect(source.messages).toHaveLength(4);
  });

  it('fork rejects non-user fork points', () => {
    const store = createInMemorySessionStore();
    const source = store.create({
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ],
    });
    expect(() => store.fork(source.id, 1)).toThrow(/must be a user message/);
  });

  it('fork rejects out-of-range indices', () => {
    const store = createInMemorySessionStore();
    const source = store.create({ messages: [{ role: 'user', content: 'u1' }] });
    expect(() => store.fork(source.id, 5)).toThrow(/out of range/);
    expect(() => store.fork(source.id, -1)).toThrow(/out of range/);
  });

  it('fork rejects unknown source id', () => {
    const store = createInMemorySessionStore();
    expect(() => store.fork('nope', 0)).toThrow(/unknown session/);
  });

  it('unsubscribe stops further events', () => {
    const store = createInMemorySessionStore();
    let count = 0;
    const off = store.subscribe(() => count++);
    store.create();
    off();
    store.create();
    expect(count).toBe(1);
  });
});
