/**
 * mu-coding plugin — packages the TUI channel + coding tools into a single
 * plugin. The standalone `mu` binary uses this as its primary surface
 * (registered by `createRegistry`) and any generic host (Arya, future web
 * app) can opt in to the coding tools by including it in its plugin list.
 *
 * The factory takes a `CodingPluginConfig` rather than reading values from
 * `PluginContext` because the TUI layer needs the **concrete**
 * `PluginRegistry` (it subscribes to renderer / shortcut / status changes
 * via methods that are not part of the read-only `PluginRegistryView`).
 * `ctx.registry` only exposes the View; the host wires the concrete
 * registry in after constructing it.
 */

import type { ApprovalGateway } from 'mu-agents';
import type { ChatMessage, Plugin, PluginContext, PluginRegistry } from 'mu-core';
import type { ShutdownFn } from './app/shutdown';
import type { AppConfig } from './config/index';
import { createCodingToolsPlugin } from './runtime/codingTools/index';
import type { HostMessageBus } from './runtime/messageBus';
import { createTuiChannel } from './tui/channel/tuiChannel';
import { createInkApprovalChannel } from './tui/plugins/InkApprovalChannel';
import type { InkUIService } from './tui/plugins/InkUIService';

export interface CodingPluginConfig {
  appConfig: AppConfig;
  initialMessages?: ChatMessage[];
  messageBus: HostMessageBus;
  uiService: InkUIService;
  shutdown: ShutdownFn;
  /**
   * Concrete `PluginRegistry` instance used by the TUI to subscribe to
   * renderers / shortcuts / status segments. Required because `ctx.registry`
   * (the read-only View) does not expose those subscription methods.
   */
  registry: PluginRegistry;
}

interface AgentPluginShape {
  approvalGateway?: ApprovalGateway;
}

export function createCodingPlugin(config: CodingPluginConfig): Plugin {
  // Coding tools are an inner plugin; we delegate via the registered tools
  // list rather than a recursive register call so a single Plugin object
  // is returned (matches the SDK's expected factory shape).
  const inner = createCodingToolsPlugin();

  // Captured at activation time so deactivate can clean up both registrations.
  let unregisterTuiChannel: (() => void) | null = null;
  let unregisterApprovalChannel: (() => void) | null = null;

  return {
    name: 'mu-coding',
    version: '0.5.0',
    tools: inner.tools,
    systemPrompt: inner.systemPrompt,
    activate(ctx: PluginContext) {
      // Forward inner plugin's activate (captures cwd for tool path resolution).
      inner.activate?.(ctx);

      // Register the TUI channel so other code can stop it gracefully via
      // ctx.channels.stopAll(). The TUI subscribes to the concrete registry
      // (passed in via config), not the narrow context-exposed view.
      unregisterTuiChannel =
        ctx.channels?.register(
          createTuiChannel({
            config: config.appConfig,
            initialMessages: config.initialMessages,
            registry: config.registry,
            messageBus: config.messageBus,
            uiService: config.uiService,
            shutdown: config.shutdown,
          }),
        ) ?? null;

      // Register the Ink approval channel against mu-agents' gateway, when
      // mu-agents is present. We use `ctx.getPlugin` to look it up loosely
      // so coding still works in setups that disabled the agent plugin.
      const agentPlugin = ctx.getPlugin?.<Plugin & AgentPluginShape>('mu-agents');
      if (agentPlugin?.approvalGateway) {
        unregisterApprovalChannel = agentPlugin.approvalGateway.registerChannel(
          'tui',
          createInkApprovalChannel(config.uiService),
        );
      }
    },
    deactivate() {
      unregisterApprovalChannel?.();
      unregisterApprovalChannel = null;
      unregisterTuiChannel?.();
      unregisterTuiChannel = null;
      inner.deactivate?.();
    },
  };
}
