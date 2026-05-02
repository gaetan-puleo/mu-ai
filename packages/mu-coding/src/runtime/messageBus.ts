import type { ChatMessage, MessageBus } from 'mu-core';

type MessageListener = (messages: ChatMessage[]) => void;
type Appender = (message: ChatMessage) => void;

export interface HostMessageBus extends MessageBus {
  /**
   * Provide the live "append a message to the transcript" hook from the React
   * tree. Called by `useChatSession` once it has stable `setMessages`. Until
   * the hook is wired, `append` queues messages so plugin activations during
   * registry construction don't lose entries.
   */
  setAppender: (fn: Appender | null) => void;
  /**
   * Replace the current `messages` array reported via `get()` and broadcast
   * to subscribers. Driven by the chat session whenever the transcript
   * changes (user send, streamed response, session reload, ...).
   */
  setMessages: (messages: ChatMessage[]) => void;
}

/**
 * Host-side bridge between plugins and the live chat transcript.
 *
 * Plugins call `append`/`injectNext`/`get`/`subscribe` through the registry
 * `PluginContext`. The mu-coding chat session wires the live transcript and
 * appender into this bus so calls made before the React tree mounts are
 * buffered and replayed once the wiring lands.
 */
export function createMessageBus(): HostMessageBus {
  let appender: Appender | null = null;
  const pendingAppends: ChatMessage[] = [];
  const pendingNextTurn: ChatMessage[] = [];
  let currentMessages: ChatMessage[] = [];
  const listeners = new Set<MessageListener>();

  const flushAppends = (): void => {
    if (!appender) return;
    while (pendingAppends.length) {
      const msg = pendingAppends.shift();
      if (msg) appender(msg);
    }
  };

  return {
    append(message) {
      if (appender) appender(message);
      else pendingAppends.push(message);
    },
    injectNext(message) {
      pendingNextTurn.push(message);
    },
    drainNext() {
      const out = pendingNextTurn.slice();
      pendingNextTurn.length = 0;
      return out;
    },
    subscribe(listener) {
      listeners.add(listener);
      // Replay current snapshot so subscribers don't miss the initial state.
      listener(currentMessages);
      return () => {
        listeners.delete(listener);
      };
    },
    get() {
      return currentMessages;
    },
    setAppender(fn) {
      appender = fn;
      flushAppends();
    },
    setMessages(next) {
      currentMessages = next;
      for (const fn of listeners) fn(next);
    },
  };
}
