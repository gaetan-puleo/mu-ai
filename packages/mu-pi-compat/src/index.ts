import {
  ConsoleUIService,
  type Plugin,
  type PluginContext,
  type PluginTool,
  type SlashCommand,
  type UIService,
} from 'mu-agents';
import { createCompatHooks } from './hooks';
import { loadAllExtensions } from './loader';
import type { PiShim } from './shim';
import type { PiCompatConfig } from './types';

export type { PiCompatConfig, UIService } from './types';
export { ConsoleUIService } from './types';

/**
 * Create the Pi compatibility plugin.
 *
 * Usage:
 * ```ts
 * import createPiCompatPlugin from 'mu-pi-compat';
 *
 * const plugin = createPiCompatPlugin({
 *   extensions: ['./my-pi-extension.ts'],
 *   ui: uiServiceInstance,
 * });
 * await registry.register(plugin);
 * ```
 */
export default function createPiCompatPlugin(config?: PiCompatConfig): Plugin {
  let extensions: PiShim[] = [];
  const cfg = config ?? {};

  const state = { turnIndex: 0, isFirstTurnOfAgent: true };
  const hooks = createCompatHooks(() => extensions, state);

  return {
    name: 'mu-pi-compat',
    version: '0.1.0',

    get tools(): PluginTool[] {
      const all: PluginTool[] = [];
      for (const ext of extensions) {
        for (const tool of ext.tools) {
          if (ext.isToolActive(tool.definition.function.name)) {
            all.push(tool);
          }
        }
      }
      return all;
    },

    get commands(): SlashCommand[] {
      return extensions.flatMap((ext) => ext.commands);
    },

    hooks,

    systemPrompt() {
      return extensions
        .map((ext) => ext.systemPromptAdditions)
        .filter(Boolean)
        .join('\n\n');
    },

    async activate(ctx: PluginContext) {
      // Host-context fallbacks let the Pi-compat plugin work either as a
      // direct registration (host injects ui/shutdown via PluginContext) or
      // as a configured plugin (host injects via PiCompatConfig).
      const ui: UIService = cfg.ui ?? ctx.ui ?? new ConsoleUIService();
      const shutdown = cfg.shutdown ?? ctx.shutdown;

      extensions = await loadAllExtensions(cfg, ctx, ui, shutdown);

      if (extensions.length > 0) {
        for (const ext of extensions) {
          await ext.fireEvent('session_start', { reason: 'startup' });
        }
      }
    },

    async deactivate() {
      if (extensions.length > 0) {
        for (const ext of extensions) {
          await ext.fireEvent('session_shutdown', { reason: 'quit' });
        }
      }
      extensions = [];
      state.turnIndex = 0;
      state.isFirstTurnOfAgent = true;
    },
  };
}
