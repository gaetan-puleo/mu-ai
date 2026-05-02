import { describe, expect, it, mock } from 'bun:test';
import type { ChatMessage, PluginRegistry } from 'mu-core';
import type { ShutdownFn } from '../../app/shutdown';
import type { AppConfig } from '../../config/index';
import type { HostMessageBus } from '../../runtime/messageBus';
import type { InkUIService } from '../plugins/InkUIService';
import { createTuiChannel } from './tuiChannel';

// Stub renderApp by mocking the import surface. We can't actually mount Ink
// in a non-TTY test environment, but we can verify the channel structure
// and that the registry passed in has the methods the TUI subscribes to.
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
  messageBus: {} as HostMessageBus,
  uiService: {} as InkUIService,
  shutdown: (async () => {
    /* test shutdown stub */
  }) as ShutdownFn,
};

describe('createTuiChannel', () => {
  it('exposes id="tui"', () => {
    const ch = createTuiChannel(fakeOpts);
    expect(ch.id).toBe('tui');
  });

  it('start is idempotent — second start is a no-op', async () => {
    const ch = createTuiChannel(fakeOpts);
    await ch.start();
    await ch.start(); // should not throw / re-mount
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

describe('createTuiChannel — registry shape contract', () => {
  it('forwards a registry that exposes the subscription methods the TUI relies on', async () => {
    // Build a registry mock whose methods are all functions; the channel's
    // `start()` calls renderApp which (in production) mounts components that
    // immediately invoke onStatusChange / onRenderersChange / etc.
    const stubFn = (): (() => void) => () => {
      /* unsub */
    };
    const fakeRegistry: Record<string, unknown> = {
      getTools: () => [],
      getFilteredTools: async () => [],
      getHooks: () => [],
      getStatusSegments: () => new Map(),
      onStatusChange: stubFn(),
      getRenderers: () => [],
      onRenderersChange: stubFn(),
      getShortcuts: () => [],
      onShortcutsChange: stubFn(),
      getCommands: () => [],
    };
    const ch = createTuiChannel({ ...fakeOpts, registry: fakeRegistry as unknown as PluginRegistry });
    renderArgs.length = 0;
    await ch.start();
    expect(renderArgs).toHaveLength(1);
    const seen = renderArgs[0].registry as unknown as Record<string, unknown>;
    for (const method of [
      'onStatusChange',
      'getStatusSegments',
      'onRenderersChange',
      'getRenderers',
      'onShortcutsChange',
      'getShortcuts',
      'getCommands',
    ]) {
      expect(typeof seen[method]).toBe('function');
    }
    await ch.stop?.();
  });
});
