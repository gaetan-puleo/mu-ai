/**
 * TUI Channel — wraps Ink rendering inside the mu-core `Channel` contract.
 * `start()` mounts the app and captures the Ink instance; `stop()` unmounts
 * it cleanly so `channels.stopAll()` restores the terminal.
 */

import type { Instance } from 'ink';
import type { Channel, ChatMessage, PluginRegistry } from 'mu-core';
import type { ShutdownFn } from '../../app/shutdown';
import type { AppConfig } from '../../config/index';
import type { HostMessageBus } from '../../runtime/messageBus';
import type { InkUIService } from '../plugins/InkUIService';
import { renderApp } from '../renderApp';

export interface TuiChannelOptions {
  config: AppConfig;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  messageBus: HostMessageBus;
  uiService: InkUIService;
  shutdown: ShutdownFn;
}

export function createTuiChannel(opts: TuiChannelOptions): Channel {
  let instance: Instance | null = null;
  return {
    id: 'tui',
    async start() {
      // Idempotent: re-starting after a stop remounts; re-starting while
      // mounted is a no-op.
      if (instance) return;
      instance = renderApp(opts);
    },
    async stop() {
      if (!instance) return;
      try {
        instance.unmount();
        // Wait for Ink's exit promise so `stopAll()` callers know the
        // terminal has been restored before they continue (e.g. emitting
        // a final shutdown message to stdout).
        await instance.waitUntilExit().catch(() => {
          /* unmount-induced exit rejects with the cause; we don't care */
        });
      } finally {
        instance = null;
      }
    },
  };
}
