import { describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginRegistry } from 'mu-core';
import type { AppConfig } from '../config/index';
import { InkUIService } from '../tui/plugins/InkUIService';
import { createRegistry } from './createRegistry';

// ─── renderApp mock ───────────────────────────────────────────────────────────
// Captures the options renderApp is called with so tests can assert what the
// TUI actually receives — specifically, that the concrete PluginRegistry (with
// subscription methods) is passed rather than the narrow PluginRegistryView.
// This mock must be declared before any test imports createRegistry so Bun's
// module mock intercepts the import in the plugin chain.

const capturedRenderArgs: Array<{ registry: PluginRegistry }> = [];
const noop = (): void => {
  /* stub */
};
mock.module('../tui/renderApp', () => ({
  renderApp: (opts: { registry: PluginRegistry }) => {
    capturedRenderArgs.push(opts);
    return {
      unmount: noop,
      waitUntilExit: async (): Promise<void> => {
        /* stub */
      },
      rerender: noop,
      cleanup: noop,
      clear: noop,
    };
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fakeConfig(): AppConfig {
  return {
    baseUrl: 'http://localhost:0',
    model: 'test-model',
    maxTokens: 1024,
    temperature: 0.7,
    streamTimeoutMs: 10_000,
  };
}

/** Methods the TUI subscribes to at runtime (not part of PluginRegistryView). */
const TUI_REGISTRY_METHODS = [
  'onStatusChange',
  'getStatusSegments',
  'onRenderersChange',
  'getRenderers',
  'onShortcutsChange',
  'getShortcuts',
  'getCommands',
] as const;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createRegistry — activation order + plugin propagation', () => {
  it('registers builtins so coding-agents see ctx.agents', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mu-cr-'));
    try {
      const ui = new InkUIService();
      const { registry, channels, providers } = await createRegistry({
        cwd,
        config: fakeConfig(),
        uiService: ui,
      });

      // Provider registered.
      expect(providers.list().some((p) => p.id === 'openai')).toBe(true);

      // All builtin plugins loaded in the correct order.
      const names = registry.getPlugins().map((p) => p.name);
      expect(names).toContain('mu-openai-provider');
      expect(names).toContain('mu-agents');
      expect(names).toContain('mu-coding');
      // mu-coding-agents is opt-in via `config.plugins`, not auto-registered.
      expect(names).not.toContain('mu-coding-agents');

      // TUI channel registered.
      expect(channels.list().map((c) => c.id)).toContain('tui');

      // mu-agents exposes its approval gateway publicly.
      interface GatewayBearer {
        approvalGateway?: { registerChannel: unknown };
      }
      const agent = registry.getPlugin<GatewayBearer & { name: string; [k: string]: unknown }>('mu-agents');
      expect(agent?.approvalGateway).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('TUI channel receives concrete PluginRegistry (not the narrow View)', async () => {
    // This test is the REAL regression guard: it calls channels.startAll()
    // which invokes tuiChannel.start() → renderApp(opts). The mock above
    // captures `opts.registry`. If createCodingPlugin ever reverts to passing
    // `ctx.registry` (the narrow View), the TUI methods below will be absent
    // and the test fails — exactly mirroring the runtime crash that would occur.
    const cwd = mkdtempSync(join(tmpdir(), 'mu-cr-'));
    try {
      const ui = new InkUIService();
      capturedRenderArgs.length = 0;
      const { channels } = await createRegistry({
        cwd,
        config: fakeConfig(),
        uiService: ui,
      });

      await channels.startAll();
      await channels.stopAll();

      expect(capturedRenderArgs).toHaveLength(1);
      const reg = capturedRenderArgs[0].registry as unknown as Record<string, unknown>;
      for (const method of TUI_REGISTRY_METHODS) {
        expect(typeof reg[method], `registry.${method} should be a function`).toBe('function');
      }
    } finally {
      capturedRenderArgs.length = 0;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('agent slash command is contributed by mu-agents (no coding-agents by default)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mu-cr-'));
    try {
      const ui = new InkUIService();
      const { registry } = await createRegistry({
        cwd,
        config: fakeConfig(),
        uiService: ui,
      });

      const commandNames = registry.getCommands().map((c) => c.name);
      expect(commandNames).toContain('agent');
      // build/plan/review come from mu-agents' DEFAULT_PRIMARY_AGENTS.
      // `explore` originates from mu-coding-agents, which is no longer auto-loaded.
      expect(commandNames).not.toContain('explore');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
