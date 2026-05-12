/**
 * Host-UI surface registrations contributed by mu-agents at activate time.
 *
 *  - `tab` shortcut         → cycle primary agents (global default)
 *  - `@` mention provider   → autocomplete subagent names
 *  - input-info indicator   → shows the active agent in the input footer
 *
 * All agent reads go through `getActiveFor(null)` (global default) since
 * these UI surfaces are not session-scoped (they apply to the host's
 * single visible session in mu-coding, or the global default in arya).
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
      const active = deps.manager.getActiveFor(null);
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
  const agent = manager.getActiveFor(null);
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
