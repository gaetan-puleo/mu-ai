import { WebSocket } from 'ws';
import type { WsInbound, WsOutbound } from './protocol';

export interface WsClientOptions {
  url: string;
  token?: string;
  sessionId?: string;
}

export interface WsClient {
  connect(): Promise<void>;
  /** Returns false (frame dropped) when the socket is not OPEN, so callers can
   * settle a just-registered request waiter instead of hanging forever. */
  send(frame: WsInbound): boolean;
  on(handler: (frame: WsOutbound) => void): () => void;
  /** Fires once when the socket closes (after a normal close or an error), so the
   * caller can reject any in-flight request waiters. */
  onClose(handler: () => void): () => void;
  close(): Promise<void>;
}

export function createWsClient(opts: WsClientOptions): WsClient {
  const handlers = new Set<(frame: WsOutbound) => void>();
  const closeHandlers = new Set<() => void>();
  let ws: WebSocket | null = null;
  let closeNotified = false;

  const url = (): string => {
    const u = new URL(opts.url);
    if (opts.token) u.searchParams.set('token', opts.token);
    if (opts.sessionId) u.searchParams.set('sessionId', opts.sessionId);
    return u.toString();
  };

  const notifyClose = (): void => {
    if (closeNotified) return;
    closeNotified = true;
    for (const h of [...closeHandlers]) h();
  };

  return {
    connect: () =>
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url());
        ws = socket;
        closeNotified = false;
        socket.on('open', () => resolve());
        // Pre-open failures reject connect(); post-open the promise is settled and
        // this is a harmless no-op that keeps the error handled.
        socket.on('error', (err: Error) => reject(err));
        // Fires on both a remote close and after an error tears the socket down;
        // lets connectHarness reject in-flight request waiters instead of hanging.
        socket.on('close', () => notifyClose());
        socket.on('message', (data: { toString(): string }) => {
          let frame: WsOutbound;
          try {
            frame = JSON.parse(data.toString()) as WsOutbound;
          } catch {
            return;
          }
          for (const handler of [...handlers]) handler(frame);
        });
      }),
    send: (frame) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(frame));
        return true;
      }
      return false;
    },
    on: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: () =>
      new Promise<void>((resolve) => {
        const socket = ws;
        ws = null;
        if (!socket) return resolve();
        socket.once('close', () => resolve());
        try {
          socket.close(1000, 'client closing');
        } catch {
          resolve();
        }
      }),
  };
}
