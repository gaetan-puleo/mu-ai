/**
 * Host-UI surface registrations contributed by mu-agents at activate
 * time. Renderer-agnostic — mu-coding/`renderApp.tsx` owns the actual
 * JSX renderer for `AGENT_MESSAGE_TYPES.subagent` and registers it via
 * `ctx.registerMessageRenderer`.
 *
 *  - `tab` shortcut         → cycle primary agents
 *  - `@` mention provider   → autocomplete subagent names
 *  - input-info indicator   → shows the active agent in the input footer
 */

import type { PluginContext } from 'mu-core';
import { agentCanDispatchSubagent } from '../dispatch/mention';
import type { AgentManager } from '../manager';
import { capitalizeAgentName } from '../utils/displayName';

export interface ActivateUIDeps {
  manager: AgentManager;
  unregisterFns: Array<() => void>;
}

export function registerTabShortcut(ctx: PluginContext, deps: ActivateUIDeps): void {
  if (!ctx.registerShortcut) return;
  deps.unregisterFns.push(
    ctx.registerShortcut('tab', () => {
      deps.manager.cycle();
    }),
  );
}

export function registerMentions(ctx: PluginContext, deps: ActivateUIDeps): void {
  if (!ctx.registerMentionProvider) return;
  deps.unregisterFns.push(
    ctx.registerMentionProvider('@', (partial) => {
      // Don't suggest subagents the active agent can't actually
      // dispatch — autocomplete for a no-op (the dispatch path itself
      // is gated in `handleSubagentMention`).
      const active = deps.manager.getActive();
      if (active && !agentCanDispatchSubagent(active)) return [];
      const lower = partial.toLowerCase();
      return deps.manager
        .getSubagents()
        .filter((a) => a.name.toLowerCase().startsWith(lower))
        .map((a) => ({
          value: a.name,
          label: a.name,
          description: a.description,
          category: 'agents',
        }));
    }),
  );
}

export function pushIndicator(ctx: PluginContext, manager: AgentManager): void {
  const agent = manager.getActive();
  if (!agent) {
    ctx.setInputInfo?.([]);
    return;
  }
  ctx.setInputInfo?.([
    {
      key: 'mu-agents.active',
      text: capitalizeAgentName(agent.name),
      color: agent.color,
      bold: true,
    },
  ]);
}
