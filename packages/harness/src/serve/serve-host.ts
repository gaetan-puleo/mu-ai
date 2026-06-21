import { type ChannelAdapter, runChannels } from '../channels/adapter';
import type { ChannelManager } from '../channels/types';
import type { Harness } from '../harness/types';
import type { ApprovalManager } from '../permissions';

/** A long-running background service (scheduler, watcher, …) the caller already started. */
export interface HostService {
  stop(): void | Promise<void>;
}

export interface ServeHostOptions {
  harness: Harness;
  approvals: ApprovalManager;
  adapters: ChannelAdapter[];
  services?: HostService[];
  handleSignals?: boolean;
}

export interface ServeHostHandle {
  manager: ChannelManager;
  shutdown(): Promise<void>;
}

/**
 * Assemble an autonomous host: run channel adapters plus background services
 * under one lifecycle. `shutdown()` tears everything down in dependency order
 * and is safe to call more than once (signals + explicit calls may race).
 */
export async function serveHost(opts: ServeHostOptions): Promise<ServeHostHandle> {
  const { harness, approvals, adapters } = opts;
  const services = opts.services ?? [];

  const channelHost = await runChannels({ harness, approvals, adapters });

  let shuttingDown: Promise<void> | undefined;

  // Signal handlers are removed before teardown so a second signal can't fire
  // a stale handler against an already-closed host (and so we don't leak them).
  const signalHandlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = [];
  const removeSignalHandlers = (): void => {
    for (const { signal, handler } of signalHandlers) process.off(signal, handler);
    signalHandlers.length = 0;
  };

  const shutdown = (): Promise<void> => {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      removeSignalHandlers();
      // Stop services first (reverse start order), then channels, then the
      // harness — services may still reference the harness while stopping.
      for (const service of [...services].reverse()) {
        try {
          await service.stop();
        } catch {
          // One service's failure must not block the rest of teardown.
        }
      }
      await channelHost.stop();
      harness.close();
    })();
    return shuttingDown;
  };

  if (opts.handleSignals) {
    const register = (signal: NodeJS.Signals, code: number): void => {
      const handler = (): void => {
        void shutdown().then(() => process.exit(code));
      };
      signalHandlers.push({ signal, handler });
      process.on(signal, handler);
    };
    register('SIGINT', 130);
    register('SIGTERM', 143);
  }

  return { manager: channelHost.manager, shutdown };
}
