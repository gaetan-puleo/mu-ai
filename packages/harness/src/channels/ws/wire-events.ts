import type { AgentSessionEvent } from '../../session';
import { messageToWire } from './wire';
import type { WsOutbound } from './protocol';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function emitSessionEvent(
  sessionId: string,
  event: AgentSessionEvent,
  toolNames: Map<string, string>,
  broadcast: (frame: WsOutbound) => void,
  onTurnStart?: (sessionId: string) => void,
): void {
  switch (event.type) {
    case 'turn_start': {
      onTurnStart?.(sessionId);
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
}
