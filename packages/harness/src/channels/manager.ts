import type { Channel, ChannelInEvent, ChannelOutEvent } from './types';

export type ChannelInListener = (channelId: string, event: ChannelInEvent) => void | Promise<void>;

export interface ChannelManager {
  add(channel: Channel): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Channel | undefined;
  list(): Channel[];
  /** Send an event to a single channel. No-op when the channel is gone. */
  send(id: string, event: ChannelOutEvent): Promise<void>;
  /** Broadcast an event to every active channel. */
  broadcast(event: ChannelOutEvent): Promise<void>;
  /**
   * Subscribe to inputs from every channel. The listener receives the channel
   * id alongside the event so callers can decide where to route it
   * (per-channel session, command vs. user_input, etc.).
   */
  onInput(listener: ChannelInListener): () => void;
  /** Stop and remove every channel. */
  stopAll(): Promise<void>;
}

export function createChannelManager(): ChannelManager {
  const channels = new Map<string, Channel>();
  const inputListeners = new Set<ChannelInListener>();

  async function fanInputToListeners(channelId: string, event: ChannelInEvent): Promise<void> {
    await Promise.all([...inputListeners].map((fn) => safeCall(() => fn(channelId, event))));
  }

  return {
    async add(channel) {
      if (channels.has(channel.id)) {
        throw new Error(`Channel "${channel.id}" is already registered`);
      }
      channels.set(channel.id, channel);
      await channel.start({
        channelId: channel.id,
        deliver: (event) => fanInputToListeners(channel.id, event),
      });
    },

    async remove(id) {
      const channel = channels.get(id);
      if (!channel) return;
      channels.delete(id);
      await safeCall(() => channel.stop());
    },

    get(id) {
      return channels.get(id);
    },

    list() {
      return [...channels.values()];
    },

    async send(id, event) {
      const channel = channels.get(id);
      if (!channel) return;
      await safeCall(() => channel.send(event));
    },

    async broadcast(event) {
      await Promise.all([...channels.values()].map((c) => safeCall(() => c.send(event))));
    },

    onInput(listener) {
      inputListeners.add(listener);
      return () => {
        inputListeners.delete(listener);
      };
    },

    async stopAll() {
      const all = [...channels.values()];
      channels.clear();
      await Promise.all(all.map((c) => safeCall(() => c.stop())));
    },
  };
}

async function safeCall(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error('[mu-harness/channels] handler threw:', error);
  }
}
