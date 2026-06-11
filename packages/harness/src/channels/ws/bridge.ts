import type { AgentSession, AgentSessionEvent } from '../../session';
import { createChannel } from '../channel';
import type { Channel } from '../types';
import { messageToWire } from './wire';
import type { WsOutbound } from './protocol';

/**
 * Bridges one session to the wire: wraps it in a {@link Channel} and translates
 * its {@link AgentSessionEvent} stream into {@link WsOutbound} frames the client
 * renders. Generalized from arya's companion channel.
 */
export interface SessionBridge {
  readonly channel: Channel;
  send(text: string): Promise<void>;
  detach(): void;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface SessionBridgeOptions {
  sessionId: string;
  getSession: () => AgentSession;
  broadcast: (frame: WsOutbound) => void;
  onTurnStart?: (sessionId: string) => void;
}

export function createSessionBridge(options: SessionBridgeOptions): SessionBridge {
  const { sessionId, broadcast } = options;
  const toolNames = new Map<string, string>();

  const emit = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case 'turn_start': {
        options.onTurnStart?.(sessionId);
        broadcast({ type: 'turn_start', sessionId });
        for (const message of messageToWire(event.input, crypto.randomUUID(), Date.now(), toolNames)) {
          broadcast({ type: 'message', sessionId, message });
        }
        return;
      }
      case 'text':
        broadcast({ type: 'stream', sessionId, text: event.text });
        return;
      case 'reasoning':
        broadcast({ type: 'reasoning', sessionId, text: event.text });
        return;
      case 'usage':
        broadcast({ type: 'usage', sessionId, usage: event.usage });
        return;
      case 'message': {
        for (const message of messageToWire(event.message, crypto.randomUUID(), Date.now(), toolNames)) {
          broadcast({ type: 'message', sessionId, message });
        }
        return;
      }
      case 'turn_end':
        broadcast({ type: 'turn_end', sessionId, reason: 'complete' });
        return;
      case 'error':
        broadcast({ type: 'error', sessionId, message: errorMessage(event.error) });
        broadcast({ type: 'turn_end', sessionId, reason: 'error' });
        return;
      default:
        return;
    }
  };

  const channel = createChannel({
    id: `ws:${sessionId}`,
    title: sessionId,
    createSession: options.getSession,
  });
  const unsubscribe = channel.subscribe(emit);

  return {
    channel,
    send: (text) => channel.send(text),
    detach: unsubscribe,
  };
}
