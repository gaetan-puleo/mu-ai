/**
 * Factory for the bootstrap-time tool pool + plugin composition.
 *
 * Composes the plugin array (provider + extras + user) and assembles the
 * tools map: dynamic mode keeps every base tool (per-turn filtering happens
 * elsewhere via the active primary's allow-list), static mode pre-filters
 * by the boot-time primary. When sub-agents are present, injects the
 * `subagent` + `subagent_parallel` dispatcher tools wired against the
 * approval queue.
 */
import type { Plugin, Tools } from 'mu-core';
import type { ApprovalQueue } from '../approvals/queue';
import { approvalQueueToPrompt } from '../approvals/queue';
import { filterToolsByPrimary } from '../sub-agents/primary';
import { createSubAgentParallelTool, createSubAgentTool } from '../sub-agents/tool';
import type { SubAgent } from '../sub-agents/types';

export interface BuildToolsAndSubagentsOptions {
  /** Base tool map (e.g. mu-tools). Filtered by the primary agent in static mode. */
  baseTools?: Tools;
  /** Pre-built provider plugin (LLM access). */
  providerPlugin?: Plugin;
  /** Additional host-supplied plugins (webfetch, scheduler, custom). */
  extraPlugins?: Plugin[];
  /** Plugins loaded from disk / npm. */
  userPlugins: Plugin[];
  /** Sub-agents (non-primary) the dispatcher tool will route to. */
  subAgents: SubAgent[];
  /** Boot-time primary agent (used by the static-mode tool filter). */
  primaryAgent: SubAgent | undefined;
  /** Approval queue, forwarded so each sub-agent's `ask` permissions reach the host UI. */
  approvalQueue: ApprovalQueue;
  /** Dynamic mode skips static tool filtering — toolFilter handles it per turn. */
  dynamic: boolean;
}

export interface ToolsAndSubagents {
  tools: Tools;
  plugins: Plugin[];
}

export function buildToolsAndSubagents(opts: BuildToolsAndSubagentsOptions): ToolsAndSubagents {
  const plugins: Plugin[] = [
    ...(opts.providerPlugin ? [opts.providerPlugin] : []),
    ...(opts.extraPlugins ?? []),
    ...opts.userPlugins,
  ];

  // Dynamic mode keeps every base tool (active filter happens in the
  // permission hook / per-turn toolFilter); static mode pre-filters by the
  // boot-time primary.
  let tools: Tools = opts.dynamic
    ? { ...(opts.baseTools ?? {}) }
    : filterToolsByPrimary(opts.baseTools ?? {}, opts.primaryAgent);

  if (opts.subAgents.length > 0) {
    const deps = {
      getSubAgents: () => opts.subAgents,
      getTools: () => tools,
      getPlugins: () => plugins,
      approvalPrompt: approvalQueueToPrompt(opts.approvalQueue),
    };
    tools = {
      ...tools,
      subagent: createSubAgentTool(deps),
      subagent_parallel: createSubAgentParallelTool(deps),
    };
  }

  return { tools, plugins };
}
