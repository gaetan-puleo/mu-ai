import { createEmitter } from '../common';
import type { AgentSession } from '../session';
import { createChannel } from './channel';
import type { Channel, ChannelManager, ChannelManagerEvent } from './types';

export const createChannelManager = (config: {
  createSession: (id: string) => AgentSession | Promise<AgentSession>;
  idGen?: () => string;
}): ChannelManager => {
  const channels = new Map<string, Channel>();
  const unsubs = new Map<string, () => void>();
  const emitter = createEmitter<ChannelManagerEvent>();

  const idGen = config.idGen ?? (() => crypto.randomUUID());

  return {
    open(opts) {
      const id = opts?.id ?? idGen();
      const title = opts?.title ?? id;
      const channel = createChannel({ id, title, createSession: config.createSession });
      channels.set(id, channel);
      unsubs.set(id, channel.subscribe((event) => emitter.emit({ channelId: id, ...event })));
      emitter.emit({ channelId: id, type: 'channel_open', title });
      return channel;
    },
    get: (id) => channels.get(id),
    list: () => [...channels.values()],
    close(id) {
      unsubs.get(id)?.();
      unsubs.delete(id);
      if (channels.delete(id)) emitter.emit({ channelId: id, type: 'channel_close' });
    },
    subscribe: emitter.subscribe,
  };
};
