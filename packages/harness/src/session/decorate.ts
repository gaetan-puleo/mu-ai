import type { ContentPart } from 'mu-core';
import type { AgentSession } from './types';

/**
 * Wrap an AgentSession, overriding ONLY `send`. Every other member is forwarded
 * to the inner session verbatim. The "decorator skeleton" lives here so the
 * persistence wrapper (persistTo) and the title-on-first-message wrapper share
 * one passthrough definition instead of each re-listing every AgentSession field.
 */
export const decorateSession = (
  session: AgentSession,
  send: (input: string | ContentPart[]) => Promise<void>,
): AgentSession => ({
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
  send,
  abort: session.abort,
  subscribe: session.subscribe,
});
