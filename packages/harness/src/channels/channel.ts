import type { ContentPart } from 'mu-core';
import { createEmitter } from '../common';
import type { AgentSession, AgentSessionEvent } from '../session';
import type { Channel } from './types';

export const createChannel = (config: {
  id: string;
  title: string;
  /**
   * Lazily produce the channel's session. Receives the channel id so a host can
   * bind the channel to a SPECIFIC (possibly persisted, reopened-from-disk)
   * session — hence the optional Promise return.
   */
  createSession: (id: string) => AgentSession | Promise<AgentSession>;
}): Channel => {
  let session: AgentSession | undefined;
  let pending: Promise<AgentSession> | undefined;
  const emitter = createEmitter<AgentSessionEvent>();

  const ensure = (): Promise<AgentSession> => {
    if (!pending) {
      pending = Promise.resolve(config.createSession(config.id)).then((s) => {
        session = s;
        s.subscribe(emitter.emit);
        return s;
      });
    }
    return pending;
  };

  return {
    id: config.id,
    title: config.title,
    get started() {
      return session !== undefined;
    },
    get messages() {
      return session?.messages ?? [];
    },
    send: async (input: string | ContentPart[]) => (await ensure()).send(input),
    abort: () => session?.abort(),
    subscribe: emitter.subscribe,
  };
};
