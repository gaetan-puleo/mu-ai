import type { SessionStore } from './store';
import type { AgentSession } from './types';

export const persistTo = (store: SessionStore, session: AgentSession, persisted = 0): AgentSession => {
  let count = persisted;
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
    assembleRequest: session.assembleRequest?.bind(session),
    countTokens: session.countTokens?.bind(session),
    send: async (input) => {
      await session.send(input);
      const all = session.messages;
      if (all.length > count) {
        await store.append(session.id, all.slice(count));
        count = all.length;
      }
    },
    abort: session.abort,
    subscribe: session.subscribe,
  };
};
