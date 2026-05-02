/**
 * Channel — input surface for sessions. A channel converts an external
 * trigger (TUI keystroke, Telegram message, voice transcription, websocket
 * frame) into an `InboundMessage` and forwards it to a `Session`.
 *
 * The abstraction is intentionally tiny: a channel knows how to start, stop,
 * and (optionally) respond. The mu-core host owns lifecycle; channels are
 * registered via `PluginContext.channels?.register(...)`.
 */

export type InboundKind = 'text' | 'audio';
export type ResponseMode = 'text' | 'voice';

export interface InboundMessage {
  kind: InboundKind;
  channelId: string;
  sessionId: string;
  messageId?: string;
  userId?: string;
  userName?: string;
  text?: string;
  responseMode?: ResponseMode;
  audio?: { url?: string; mimeType?: string; filePath?: string };
  raw?: unknown;
}

export interface ChannelResponder {
  sendText: (text: string) => Promise<void>;
  sendVoice?: (text: string) => Promise<void>;
  sendAck?: (text: string) => Promise<void>;
  sendError?: (text: string) => Promise<void>;
}

export interface Channel {
  id: string;
  start: () => Promise<void>;
  stop?: () => Promise<void>;
}

export interface ChannelRegistry {
  register: (channel: Channel) => () => void;
  list: () => Channel[];
  get: (id: string) => Channel | undefined;
  startAll: () => Promise<void>;
  stopAll: () => Promise<void>;
}

export function createChannelRegistry(): ChannelRegistry {
  const channels = new Map<string, Channel>();
  return {
    register(channel) {
      if (channels.has(channel.id)) {
        throw new Error(`Channel already registered: ${channel.id}`);
      }
      channels.set(channel.id, channel);
      return () => {
        channels.delete(channel.id);
      };
    },
    list() {
      return Array.from(channels.values());
    },
    get(id) {
      return channels.get(id);
    },
    async startAll() {
      for (const c of channels.values()) {
        await c.start();
      }
    },
    async stopAll() {
      for (const c of channels.values()) {
        if (c.stop) await c.stop();
      }
    },
  };
}
