import type { Message } from 'mu-core';
import type { SessionStore } from './store';
import type { AgentSession } from './types';

export const persistTo = (store: SessionStore, session: AgentSession, persisted = 0): AgentSession => {
  let count = persisted;
  let last: Message | undefined = count > 0 ? session.messages[count - 1] : undefined;
  return {
    get id() {
      return session.id;
    },
    get messages() {
      return session.messages;
    },
    get tools() {
      return session.tools;
    },
    model: session.model,
    assembleRequest: session.assembleRequest?.bind(session),
    countTokens: session.countTokens?.bind(session),
    contextWindow: session.contextWindow?.bind(session),
    compact: session.compact?.bind(session),
    send: async (input) => {
      await session.send(input);
      const all = session.messages;
      const intact = count === 0 || all[count - 1] === last;
      if (!intact) {
        await store.rewrite(session.id, all);
      } else if (all.length > count) {
        await store.append(session.id, all.slice(count));
      }
      count = all.length;
      last = all.length > 0 ? all[all.length - 1] : undefined;
    },
    abort: session.abort,
    subscribe: session.subscribe,
  };
};
