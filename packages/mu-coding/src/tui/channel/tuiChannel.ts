import type { Instance } from 'ink';
import type { SubagentRunRegistry } from 'mu-agents';
import type { Channel, ChatMessage, PluginRegistry, SessionManager, SessionStore, SubmitTextInput, SubmitTextResult } from 'mu-core';
import type { ShutdownFn } from '../../app/shutdown';
import type { AppConfig } from '../../config/index';
import type { InkUIService } from '../plugins/InkUIService';
import { renderApp } from '../renderApp';

interface TuiChannelOptions {
  config: AppConfig;
  initialSessionId: string;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  sessions: SessionManager;
  store: SessionStore;
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>;
  uiService: InkUIService;
  shutdown: ShutdownFn;
  subagentRuns?: SubagentRunRegistry;
}

export function createTuiChannel(opts: TuiChannelOptions): Channel {
  let instance: Instance | null = null;
  return {
    id: 'tui',
    async start() {
      if (instance) return;
      instance = renderApp({
        config: opts.config,
        initialSessionId: opts.initialSessionId,
        initialMessages: opts.initialMessages,
        registry: opts.registry,
        sessions: opts.sessions,
        store: opts.store,
        submitText: opts.submitText,
        uiService: opts.uiService,
        shutdown: opts.shutdown,
        subagentRuns: opts.subagentRuns,
      });
    },
    async stop() {
      if (!instance) return;
      try {
        instance.unmount();
        await instance.waitUntilExit().catch(() => {});
      } finally {
        instance = null;
      }
    },
  };
}
