import { describe, expect, it, mock } from 'bun:test';
import type { ChatMessage, PluginRegistry, SessionManager } from 'mu-core';
import type { ShutdownFn } from '../../app/shutdown';
import type { AppConfig } from '../../config/index';
import type { InkUIService } from '../plugins/InkUIService';
import { createTuiChannel } from './tuiChannel';

const noop = (): void => {
  /* stub */
};

const renderArgs: Array<{ registry: PluginRegistry; config: AppConfig }> = [];
mock.module('../renderApp', () => ({
  renderApp: (opts: { registry: PluginRegistry; config: AppConfig }) => {
    renderArgs.push(opts);
    return {
      unmount: noop,
      waitUntilExit: async () => {
        /* stub */
      },
      rerender: noop,
      cleanup: noop,
      clear: noop,
    };
  },
}));

const fakeOpts = {
  config: {} as AppConfig,
  initialMessages: [] as ChatMessage[],
  registry: {} as PluginRegistry,
  sessions: {} as SessionManager,
  submitText: async () => ({ kind: 'ran' }) as const,
  uiService: {} as InkUIService,
  shutdown: (async () => {}) as ShutdownFn,
};

describe('createTuiChannel', () => {
  it('exposes id="tui"', () => {
    const ch = createTuiChannel(fakeOpts);
    expect(ch.id).toBe('tui');
  });

  it('start is idempotent', async () => {
    const ch = createTuiChannel(fakeOpts);
    await ch.start();
    await ch.start();
  });

  it('stop without start is a no-op', async () => {
    const ch = createTuiChannel(fakeOpts);
    await ch.stop?.();
  });

  it('start → stop → start cycles cleanly', async () => {
    const ch = createTuiChannel(fakeOpts);
    await ch.start();
    await ch.stop?.();
    await ch.start();
    await ch.stop?.();
  });
});
