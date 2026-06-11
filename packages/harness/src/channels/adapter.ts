import type { ApprovalManager } from '../permissions';
import type { Harness } from '../harness/types';
import { createChannelManager } from './manager';
import type { ChannelManager } from './types';

/**
 * What a {@link ChannelAdapter} receives when started: the host harness, the
 * shared {@link ChannelManager} all adapters multiplex through, and the host's
 * approval manager (so a surface can present tool approvals).
 */
export interface ChannelAdapterContext {
  readonly harness: Harness;
  readonly manager: ChannelManager;
  readonly approvals: ApprovalManager;
}

export interface ChannelAdapterHandle {
  stop(): Promise<void>;
}

/**
 * A uniform way to attach a conversation surface (companion, TUI, Discord, …) to
 * a harness. Each adapter binds its transport/integration to the shared
 * {@link ChannelManager}: inbound surface messages → `channel.send`, channel
 * events → the surface. This layer is network-free; concrete transports (e.g. a
 * WebSocket server) live in their own packages and only implement this contract.
 */
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

/**
 * Build one {@link ChannelManager} over the harness' sessions and start every
 * adapter against it — the single registration point for all channels (the "2
 * ways to use the harness": an adapter may be in-process or a network transport).
 * Returns a combined stop that tears adapters down (reverse order) then closes
 * any remaining channels.
 */
export async function runChannels(opts: RunChannelsOptions): Promise<ChannelHost> {
  const { harness, approvals, adapters, idGen } = opts;
  const manager = createChannelManager({
    createSession: () => harness.sessions.create(),
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
