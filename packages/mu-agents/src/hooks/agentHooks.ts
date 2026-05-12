/**
 * mu-agents' contribution to the host's lifecycle hook chain.
 *
 *  - `beforeLlmCall`        — snapshots the live model so subagents stay in sync
 *  - `decorateMessage`      — stamps the active agent's badge/color/meta.agent
 *  - `transformSystemPrompt` — injects the active agent's system prompt
 *  - `filterTools`          — restricts the LLM-visible tool set
 *  - `beforeToolExec`       — enforces permission gates (allow/deny/ask)
 *  - `transformUserInput`   — forces `@<subagent>` dispatch + injects
 *                             agent-switch notes
 */

import type {
  ChatMessage,
  LifecycleHooks,
  PluginContext,
  PluginRegistryView,
  ProviderConfig,
} from 'mu-core';
import { makeSyntheticMessage } from 'mu-core';
import type { ApprovalGateway } from '../approval';
import {
  handleSubagentMention,
  type MentionDispatchDeps,
} from '../dispatch/mention';
import type { AgentManager } from '../manager';
import { enforceAgentPermissions } from '../permissionGate';
import type { SubagentRunRegistry } from '../subagentRun';
import {
  type AgentSwitchTracker,
  buildAgentSwitchNote,
  resetTracker,
} from '../switchTracker';
import type { AgentDefinition } from '../types';

export interface BuildHooksDeps {
  manager: AgentManager;
  modelRef: { current: string };
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  registryRef: { current: PluginRegistryView | null };
  tracker: AgentSwitchTracker;
  ctxRef: { current: PluginContext | null };
  /** Provider config + run registry — required for forced @-mention dispatch. */
  config?: ProviderConfig;
  runRegistry: SubagentRunRegistry;
  resolveSubagentSessionPath: (runId: string) => string | undefined;
}

/**
 * Build the per-agent system prompt the LLM sees. Prepends the agent
 * body with its allowed-tool whitelist plus subagent dispatch
 * instructions when relevant.
 */
function renderAgentPrompt(agent: AgentDefinition, subagents: AgentDefinition[]): string {
  const tools = agent.tools.length > 0 ? agent.tools.join(', ') : 'none';
  const lines = [
    `## Active agent: ${agent.name}`,
    '',
    agent.systemPrompt,
    '',
    `Available tools: ${tools}. Do not call other tools — the host enforces the whitelist.`,
  ];

  const hasSubagent =
    agent.tools.includes('subagent') ||
    agent.tools.includes('subagent_parallel') ||
    agent.tools.includes('*');
  if (hasSubagent && subagents.length > 0) {
    lines.push('');
    lines.push('### Subagents');
    lines.push('Available subagents:');
    for (const sa of subagents) {
      lines.push(`- \`${sa.name}\` — ${sa.description}`);
    }
    lines.push('');
    lines.push(
      'You may proactively delegate work to a subagent by calling the `subagent` tool ' +
        '(or `subagent_parallel` for several at once). Compose a precise task description from ' +
        'the conversation context and pass it as `task=<description>`.',
    );
    lines.push(
      'While a subagent is running, do **not** redo the same delegated work yourself — the ' +
        "subagent owns that piece. Once it returns, the turn isn't over: relay its findings to " +
        "the user (attributing them by name) and then continue working on the user's original " +
        'task. Take the next concrete step — call another tool, dispatch another subagent, or ' +
        'make the required edit. Stop only when the original task is fully complete.',
    );
  }
  return lines.join('\n');
}

/**
 * Stamp every freshly-built USER message with the active agent's name +
 * color so per-message attribution survives downstream renderers. We
 * intentionally only stamp user messages: assistant messages come back
 * from the LLM and are attributed at persist time by the host factory.
 */
function stampActiveAgent(msg: ChatMessage, manager: AgentManager): ChatMessage {
  if (msg.display?.hidden) return msg;
  if (msg.role !== 'user') return msg;
  const agent = manager.getActive();
  if (!agent) return msg;
  const display = msg.display ?? {};
  const meta = msg.meta ?? {};
  return {
    ...msg,
    display: {
      ...display,
      badge: display.badge ?? agent.name,
      color: display.color ?? agent.color,
    },
    meta: { ...meta, agent: meta.agent ?? agent.name },
  };
}

export function buildHooks(deps: BuildHooksDeps): LifecycleHooks {
  // The mention dispatcher's deps are a subset of the hook deps.
  const mentionDeps: MentionDispatchDeps = {
    manager: deps.manager,
    modelRef: deps.modelRef,
    approvalGateway: deps.approvalGateway,
    approvalChannelId: deps.approvalChannelId,
    registryRef: deps.registryRef,
    ctxRef: deps.ctxRef,
    config: deps.config,
    runRegistry: deps.runRegistry,
    resolveSubagentSessionPath: deps.resolveSubagentSessionPath,
  };

  return {
    // Capture the live model on every LLM call so subagents launched
    // mid-session use whatever model the user is currently driving the
    // host with — not the one frozen at plugin construction time.
    beforeLlmCall: (messages, config) => {
      if (config.model) deps.modelRef.current = config.model;
      return messages;
    },
    decorateMessage: (msg) => stampActiveAgent(msg, deps.manager),
    transformSystemPrompt: (prompt) => {
      const agent = deps.manager.getActive();
      if (!agent) return prompt;
      const rendered = renderAgentPrompt(agent, deps.manager.getSubagents());
      return prompt ? `${prompt}\n\n${rendered}` : rendered;
    },
    filterTools: (tools) => {
      const agent = deps.manager.getActive();
      if (!agent || agent.tools.includes('*')) return tools;
      const allowed = new Set(agent.tools);
      return tools.filter((t) => allowed.has(t.definition.function.name));
    },
    beforeToolExec: async (call) => {
      const agent = deps.manager.getActive();
      if (!agent) return call;
      return enforceAgentPermissions({
        agent,
        registry: deps.registryRef.current,
        approvalGateway: deps.approvalGateway,
        approvalChannelId: deps.approvalChannelId,
        call,
      });
    },
    transformUserInput: async (text) => {
      const handled = await handleSubagentMention(text, mentionDeps);

      const active = deps.manager.getActive();
      // Seed the tracker with the agent at first send so the very first
      // user message doesn't trigger a spurious inject.
      if (active && deps.tracker.current === null) {
        deps.tracker.current = active.name;
      }
      if (active) {
        const note = buildAgentSwitchNote(deps.tracker, active.name);
        if (note) {
          deps.ctxRef.current?.messages?.injectNext(
            makeSyntheticMessage({
              role: 'system',
              content: note,
              display: { hidden: true },
              agent: active.name,
              source: 'mu-agents.switch',
            }),
          );
        }
        // Reset the traversal so the next inject only fires if the user
        // switches agents again before the next send.
        resetTracker(deps.tracker, active.name);
      }

      return handled ? { kind: 'continue' } : { kind: 'pass' };
    },
  };
}
