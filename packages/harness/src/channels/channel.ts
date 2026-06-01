import type { ContentPart } from 'mu-core';
import { createEmitter } from '../common';
import type { AgentSession, AgentSessionEvent } from '../session';
import type { Channel } from './types';

export const createChannel = (config: {
  id: string;
  title: string;
  createSession: () => AgentSession;
}): Channel => {
  let session: AgentSession | undefined;
  const emitter = createEmitter<AgentSessionEvent>();

  const ensure = (): AgentSession => {
    if (!session) {
      session = config.createSession();
      session.subscribe(emitter.emit);
    }
    return session;
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
    send: (input: string | ContentPart[]) => ensure().send(input),
    abort: () => session?.abort(),
    subscribe: emitter.subscribe,
  };
};
