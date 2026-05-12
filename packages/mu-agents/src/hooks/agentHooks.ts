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
 *
 * All hooks that read the active agent use `getActiveFor(sessionId)` so
 * different sessions can have different agents. The session id comes
 * from the `MessageBusRouter.getCurrentSession()` pin set by `runHostTurn`.
 */

import type { ChatMessage, LifecycleHooks, MessageBus, PluginContext, PluginRegistryView, ProviderConfig } from 'mu-core';
import type { MessageBusRouter } from 'mu-core';
import { makeSyntheticMessage } from 'mu-core';
import type { ApprovalGateway } from '../approval';
import { handleSubagentMention, type MentionDispatchDeps } from '../dispatch/mention';
import type { AgentManager } from '../manager';
import { enforceAgentPermissions } from '../permissionGate';
import type { SubagentRunRegistry } from '../subagentRun';
import { type AgentSwitchTracker, buildAgentSwitchNote, resetTracker } from '../switchTracker';
import type { AgentDefinition } from '../types';

interface BuildHooksDeps {
  manager: AgentManager;
  modelRef: { current: string };
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  registryRef: { current: PluginRegistryView | null };
  tracker: AgentSwitchTracker;
  ctxRef: { current: PluginContext | null };
  config?: ProviderConfig;
  runRegistry: SubagentRunRegistry;
  resolveSubagentSessionPath: (runId: string) => string | undefined;
}

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
    agent.tools.includes('subagent') || agent.tools.includes('subagent_parallel') || agent.tools.includes('*');
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
 * Read the current session id from the MessageBus. When the bus is a
 * `MessageBusRouter` (the normal case), it exposes `getCurrentSession()`.
 * Returns `null` for plain buses or when unpinned.
 */
function readSessionId(bus: MessageBus | null | undefined): string | null {
  if (!bus) return null;
  if ('getCurrentSession' in bus && typeof (bus as MessageBusRouter).getCurrentSession === 'function') {
    return (bus as MessageBusRouter).getCurrentSession();
  }
  return null;
}

/**
 * Resolve the active agent for the current hook context. Uses the
 * session-scoped agent when available, falls back to global.
 */
function resolveActive(deps: BuildHooksDeps): AgentDefinition | undefined {
  const sessionId = readSessionId(deps.ctxRef.current?.messages);
  return deps.manager.getActiveFor(sessionId);
}

function stampActiveAgent(msg: ChatMessage, deps: BuildHooksDeps): ChatMessage {
  if (msg.display?.hidden) return msg;
  if (msg.role !== 'user') return msg;
  const agent = resolveActive(deps);
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
    beforeLlmCall: (messages, config) => {
      if (config.model) deps.modelRef.current = config.model;
      return messages;
    },
    decorateMessage: (msg) => stampActiveAgent(msg, deps),
    transformSystemPrompt: (prompt) => {
      const agent = resolveActive(deps);
      if (!agent) return prompt;
      const rendered = renderAgentPrompt(agent, deps.manager.getSubagents());
      return prompt ? `${prompt}\n\n${rendered}` : rendered;
    },
    filterTools: (tools) => {
      const agent = resolveActive(deps);
      if (!agent || agent.tools.includes('*')) return tools;
      const allowed = new Set(agent.tools);
      return tools.filter((t) => allowed.has(t.definition.function.name));
    },
    beforeToolExec: async (call) => {
      const agent = resolveActive(deps);
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

      const active = resolveActive(deps);
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
        resetTracker(deps.tracker, active.name);
      }

      return handled ? { kind: 'continue' } : { kind: 'pass' };
    },
  };
}
