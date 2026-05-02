import { describe, expect, it, mock } from 'bun:test';
import type { ChatMessage } from 'mu-provider';
import { createMessageBus } from './messageBus';

const userMsg = (text: string): ChatMessage => ({ role: 'user', content: text });

describe('createMessageBus', () => {
  it('queues appends until an appender is wired', () => {
    const bus = createMessageBus();
    bus.append(userMsg('hi'));
    bus.append(userMsg('there'));
    const seen: ChatMessage[] = [];
    bus.setAppender((m) => seen.push(m));
    expect(seen.map((m) => m.content)).toEqual(['hi', 'there']);
  });

  it('forwards subsequent appends through the wired appender', () => {
    const bus = createMessageBus();
    const appender = mock(() => {
      /* spy only */
    });
    bus.setAppender(appender);
    bus.append(userMsg('one'));
    bus.append(userMsg('two'));
    expect(appender).toHaveBeenCalledTimes(2);
  });

  it('drainNext returns and clears injectNext payload', () => {
    const bus = createMessageBus();
    bus.injectNext(userMsg('a'));
    bus.injectNext(userMsg('b'));
    expect(bus.drainNext().map((m) => m.content)).toEqual(['a', 'b']);
    expect(bus.drainNext()).toEqual([]);
  });

  it('subscribe replays the current snapshot once', () => {
    const bus = createMessageBus();
    bus.setMessages([userMsg('hello')]);
    const seen: string[] = [];
    bus.subscribe((m) => seen.push(m.map((x) => x.content).join(',')));
    expect(seen).toEqual(['hello']);
  });

  it('subscribe fires on subsequent setMessages and unsubscribes cleanly', () => {
    const bus = createMessageBus();
    const updates: number[] = [];
    const off = bus.subscribe((m) => updates.push(m.length));
    bus.setMessages([userMsg('a')]);
    bus.setMessages([userMsg('a'), userMsg('b')]);
    off();
    bus.setMessages([userMsg('c')]);
    expect(updates).toEqual([0, 1, 2]);
  });

  it('get reflects the latest setMessages snapshot', () => {
    const bus = createMessageBus();
    expect(bus.get()).toEqual([]);
    const msgs = [userMsg('x')];
    bus.setMessages(msgs);
    expect(bus.get()).toEqual(msgs);
  });
});
