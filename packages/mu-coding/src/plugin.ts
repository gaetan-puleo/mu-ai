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

import type { ApprovalGateway, SubagentRunRegistry } from 'mu-agents';
import type { ChatMessage, Plugin, PluginContext, PluginRegistry } from 'mu-core';
import type { ShutdownFn } from './app/shutdown';
import type { AppConfig } from './config/index';
import { createCodingToolsPlugin } from './runtime/codingTools/index';
import type { SessionPathHolder } from './runtime/createRegistry';
import { createFileMentionProvider } from './runtime/fileMentionProvider';
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
   * Mutable holder updated by the TUI's session persistence hook so other
   * plugins (mu-agents) can read the current parent session path when
   * dispatching subagents. `undefined` until the React tree mounts.
   */
  sessionPathHolder?: SessionPathHolder;
  /**
   * Concrete `PluginRegistry` instance used by the TUI to subscribe to
   * renderers / shortcuts / status segments. Required because `ctx.registry`
   * (the read-only View) does not expose those subscription methods.
   */
  registry: PluginRegistry;
}

interface AgentPluginShape {
  approvalGateway?: ApprovalGateway;
  runs?: SubagentRunRegistry;
}

export function createCodingPlugin(config: CodingPluginConfig): Plugin {
  // Coding tools are an inner plugin; we delegate via the registered tools
  // list rather than a recursive register call so a single Plugin object
  // is returned (matches the SDK's expected factory shape).
  const inner = createCodingToolsPlugin();

  // Captured at activation time so deactivate can clean up both registrations.
  let unregisterTuiChannel: (() => void) | null = null;
  let unregisterApprovalChannel: (() => void) | null = null;
  let unregisterFileMentions: (() => void) | null = null;

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
      // Resolve the live mu-agents handle so the TUI can subscribe to the
      // subagent run registry (browser panel + live header). Looked up
      // loosely so coding still works in setups that disabled the agent
      // plugin — the TUI then renders a fallback header without the live
      // subagent navigation surfaces.
      const agentPlugin = ctx.getPlugin?.<Plugin & AgentPluginShape>('mu-agents');

      unregisterTuiChannel =
        ctx.channels?.register(
          createTuiChannel({
            config: config.appConfig,
            initialMessages: config.initialMessages,
            registry: config.registry,
            messageBus: config.messageBus,
            uiService: config.uiService,
            shutdown: config.shutdown,
            sessionPathHolder: config.sessionPathHolder,
            subagentRuns: agentPlugin?.runs,
          }),
        ) ?? null;

      // Register a file completion provider on `@`. Sits alongside the
      // mu-agents `@`-provider — useMentionPicker concatenates results from
      // every provider matching a trigger, grouped by category in the UI.
      // When the user types `@foo`, agents that match by name appear first;
      // files matching by basename/path follow.
      if (ctx.registerMentionProvider) {
        unregisterFileMentions = ctx.registerMentionProvider('@', createFileMentionProvider(ctx.cwd));
      }

      // Register the Ink approval channel against mu-agents' gateway when
      // it's available (the lookup above already resolved `agentPlugin`).
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
      unregisterFileMentions?.();
      unregisterFileMentions = null;
      unregisterTuiChannel?.();
      unregisterTuiChannel = null;
      inner.deactivate?.();
    },
  };
}
