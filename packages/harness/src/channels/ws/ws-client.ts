import { WebSocket } from 'ws';
import type { WsInbound, WsOutbound } from './protocol';

export interface WsClientOptions {
  url: string;
  token?: string;
  sessionId?: string;
}

export interface WsClient {
  connect(): Promise<void>;
  send(frame: WsInbound): void;
  on(handler: (frame: WsOutbound) => void): () => void;
  close(): Promise<void>;
}

export function createWsClient(opts: WsClientOptions): WsClient {
  const handlers = new Set<(frame: WsOutbound) => void>();
  let ws: WebSocket | null = null;

  const url = (): string => {
    const u = new URL(opts.url);
    if (opts.token) u.searchParams.set('token', opts.token);
    if (opts.sessionId) u.searchParams.set('sessionId', opts.sessionId);
    return u.toString();
  };

  return {
    connect: () =>
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url());
        ws = socket;
        socket.on('open', () => resolve());
        // Pre-open failures reject connect(); post-open the promise is settled and
        // this is a harmless no-op that keeps the error handled.
        socket.on('error', (err: Error) => reject(err));
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
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    },
    on: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
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
