import { describe, expect, it } from 'bun:test';
import type { Session } from '../session';
import type { ChatMessage } from '../types/llm';
import { createSessionScopedMessageBus } from './sessionScoped';

function fakeSession(id: string, appendSpy: ChatMessage[]): Session {
  return {
    id,
    getMessages: () => [],
    setMessages: () => undefined,
    submit: async () => undefined,
    runTurn: async () => null,
    abort: () => undefined,
    appendSynthetic: (msg) => {
      appendSpy.push(msg);
    },
    queueForNextTurn: () => undefined,
    subscribe: () => () => undefined,
  };
}

describe('createSessionScopedMessageBus — late binding', () => {
  it('honours setResolveSession assigned after construction', () => {
    const appended: ChatMessage[] = [];
    const session = fakeSession('s1', appended);
    const bus = createSessionScopedMessageBus({});
    bus.setCurrentSession('s1');
    // Append before resolveSession is wired — must not throw, no mirror.
    bus.append({ role: 'assistant', content: 'first' });
    expect(appended).toEqual([]);

    bus.setResolveSession((id) => (id === 's1' ? session : undefined));
    bus.append({ role: 'assistant', content: 'second' });
    expect(appended).toHaveLength(1);
    expect(appended[0]?.content).toBe('second');
  });

  it('honours setSyntheticAppendListener assigned after construction', () => {
    const sink: Array<{ id: string; msg: ChatMessage }> = [];
    const bus = createSessionScopedMessageBus({});
    bus.setCurrentSession('s1');
    bus.append({ role: 'assistant', content: 'before-wire' });
    expect(sink).toEqual([]);

    bus.setSyntheticAppendListener((id, msg) => sink.push({ id, msg }));
    bus.append({ role: 'assistant', content: 'after-wire' });
    expect(sink).toHaveLength(1);
    expect(sink[0]?.id).toBe('s1');
    expect(sink[0]?.msg.content).toBe('after-wire');
  });

  it('setResolveSession(null) clears the binding', () => {
    const appended: ChatMessage[] = [];
    const session = fakeSession('s1', appended);
    const bus = createSessionScopedMessageBus({
      resolveSession: () => session,
    });
    bus.setCurrentSession('s1');
    bus.append({ role: 'assistant', content: 'first' });
    expect(appended).toHaveLength(1);
    bus.setResolveSession(null);
    bus.append({ role: 'assistant', content: 'second' });
    expect(appended).toHaveLength(1);
  });
});
