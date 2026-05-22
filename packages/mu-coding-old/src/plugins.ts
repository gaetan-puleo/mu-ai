/**
 * Plugin assembly for mu-coding.
 *
 * The TUI host always wires `mu-local-provider`, `mu-tools`, and
 * `mu-skill-runner`. Additional plugins are opted-in via `config.plugins`
 * in ~/.config/mu/config.json.
 *
 * Supported optional names today:
 *   - "mu-agents"          — agents runtime
 *   - "mu-coding-agents"   — bundled default agents (requires "mu-agents")
 *
 * `mu-tools` and `mu-skill-runner` are always-on. Listing them explicitly is
 * a no-op (with a one-line note on stderr). Unknown names are ignored with a
 * warning.
 *
 * `mu-coding-agents` does NOT auto-include `mu-agents` — that was an explicit
 * design choice to keep config behaviour predictable. Listing `mu-coding-
 * agents` alone emits a warning and drops both (no agents available).
 */

import { type AgentsHandle, type ApprovalChannel, createAgentsPlugin, type KeybindChannel } from 'mu-agents';
import { createCodingAgentsPlugin } from 'mu-coding-agents';
import type { Plugin } from 'mu-core';
import { createLocalProviderPlugin, type LocalProviderHandle } from 'mu-local-provider';
import { createSkillRunnerPlugin } from 'mu-skill-runner';
import { createMuToolsPlugin } from 'mu-tools';

export interface AssembleOptions {
  /** Plugin names from `config.plugins`. */
  configPlugins: readonly string[];
  /** Approval channel forwarded to mu-agents when it is enabled. */
  approval?: ApprovalChannel;
  /**
   * Keybind channel forwarded to mu-agents when it is enabled. When the
   * host omits this, mu-agents silently skips its keybind wiring. The TUI
   * host adapts its `TUI_KEYBINDS` singleton + active-session bridge into
   * this structural channel (see `runTui` in tui.tsx).
   */
  keybinds?: KeybindChannel;
}

export interface Assembled {
  plugins: Plugin[];
  /** Set when `mu-agents` was enabled. */
  agentsHandle?: AgentsHandle;
  /** Always set; lets the TUI read server-kind detection and per-model context limits. */
  localProviderHandle: LocalProviderHandle;
}

const KNOWN_OPTIONAL = new Set(['mu-agents', 'mu-coding-agents']);

function warn(msg: string): void {
  process.stderr.write(`[mu] ${msg}\n`);
}

export function assemblePlugins(opts: AssembleOptions): Assembled {
  const requested = new Set(opts.configPlugins);

  // Surface configuration mistakes up-front. We do not throw — mu-coding is
  // a TUI, surfacing a startup warning is friendlier than a stack trace.
  for (const name of requested) {
    if (name === 'mu-tools' || name === 'mu-skill-runner') {
      warn(`"${name}" is always enabled; ignoring its entry in config.plugins.`);
      continue;
    }
    if (!KNOWN_OPTIONAL.has(name)) {
      warn(`unknown plugin "${name}" in config.plugins; ignoring.`);
    }
  }

  const wantAgents = requested.has('mu-agents');
  const wantCodingAgents = requested.has('mu-coding-agents');

  if (wantCodingAgents && !wantAgents) {
    warn('"mu-coding-agents" requires "mu-agents" to also be listed; both will be skipped.');
  }
  if (wantAgents && !wantCodingAgents) {
    warn('"mu-agents" is listed without any agent provider (e.g. "mu-coding-agents"); no agents will be available.');
  }

  const localProviderPlugin = createLocalProviderPlugin();
  const plugins: Plugin[] = [
    localProviderPlugin,
    createMuToolsPlugin({ restrictToCwd: false }),
    createSkillRunnerPlugin(),
  ];
  let agentsHandle: AgentsHandle | undefined;

  // Contributor plugins MUST register before the agents plugin so
  // `contributeAgentsDir` has populated the module-level queue by the time
  // `mu-agents` drains it (see packages/mu-agents/src/plugin.ts). When the
  // user listed only `mu-coding-agents`, we deliberately skip BOTH so the
  // contributed-dir queue does not leak into a later run (e.g. in tests).
  if (wantAgents && wantCodingAgents) {
    plugins.push(createCodingAgentsPlugin());
  }
  if (wantAgents) {
    const agents = createAgentsPlugin({
      approval: opts.approval,
      keybinds: opts.keybinds,
    });
    agentsHandle = agents.handle;
    plugins.push(agents);
  }

  return { plugins, agentsHandle, localProviderHandle: localProviderPlugin.handle };
}
