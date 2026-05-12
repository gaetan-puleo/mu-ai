/**
 * Channel — external I/O surface.
 *
 * A channel converts external triggers (TUI keystrokes, WebSocket frames,
 * Telegram messages, scheduler ticks) into `runtime.submitText()` calls
 * and broadcasts session events outward.
 *
 * Channels must not:
 * - Start side effects in constructors.
 * - Run turns manually.
 * - Reimplement hook orchestration.
 */

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
  let started = false;

  return {
    register(channel) {
      if (channels.has(channel.id)) {
        throw new Error(`Channel already registered: ${channel.id}`);
      }
      channels.set(channel.id, channel);
      if (started) {
        channel.start().catch(() => {
          /* swallow async start errors for late registrations */
        });
      }
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
      started = true;
      for (const c of channels.values()) {
        await c.start();
      }
    },
    async stopAll() {
      for (const c of channels.values()) {
        if (c.stop) await c.stop();
      }
      started = false;
    },
  };
}
