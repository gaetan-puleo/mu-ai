import type { ApprovalManager } from '../permissions';
import type { Harness } from '../harness/types';
import { createChannelManager } from './manager';
import type { ChannelManager } from './types';

export interface ChannelAdapterContext {
  readonly harness: Harness;
  readonly manager: ChannelManager;
  readonly approvals: ApprovalManager;
}

export interface ChannelAdapterHandle {
  stop(): Promise<void>;
}

export interface ChannelAdapter {
  readonly name: string;
  start(ctx: ChannelAdapterContext): Promise<ChannelAdapterHandle>;
}

export interface RunChannelsOptions {
  harness: Harness;
  approvals: ApprovalManager;
  adapters: ChannelAdapter[];
  idGen?: () => string;
}

export interface ChannelHost {
  readonly manager: ChannelManager;
  stop(): Promise<void>;
}

export async function runChannels(opts: RunChannelsOptions): Promise<ChannelHost> {
  const { harness, approvals, adapters, idGen } = opts;
  // Channels bind to a SPECIFIC session id: reopen it from disk if it exists,
  // else create it. This is what lets a network adapter address persisted
  // sessions by id (a plain `() => create()` could only ever make new ones).
  const manager = createChannelManager({
    createSession: async (id) => {
      const stored = await harness.sessions.read(id);
      return stored ? await harness.sessions.open(id) : harness.sessions.create({ id });
    },
    idGen,
  });

  const handles: ChannelAdapterHandle[] = [];
  for (const adapter of adapters) {
    handles.push(await adapter.start({ harness, manager, approvals }));
  }

  return {
    manager,
    stop: async () => {
      for (const handle of handles.reverse()) await handle.stop();
      for (const channel of manager.list()) manager.close(channel.id);
    },
  };
}
