/**
 * `@<subagent>` mention dispatch.
 *
 * The LLM is too unreliable to invoke the `subagent` tool from plain
 * text alone (small models frequently skip the call or duplicate work),
 * so we pre-run the subagent in the `transformUserInput` hook when the
 * user's input starts with `@<name>`. The result is queued into the
 * next turn so the parent agent streams a real follow-up response
 * over the augmented transcript.
 *
 * Permission gating mirrors `filterTools`: an agent that can't call the
 * `subagent` tool can't dispatch via `@` either.
 */

import { makeSyntheticMessage, runDecorateMessageHooks } from 'mu-core';
import type {
  ChatMessage,
  MessageBus,
  PluginContext,
  PluginRegistryView,
  ProviderConfig,
} from 'mu-core';
import type { ApprovalGateway } from '../approval';
import type { AgentManager } from '../manager';
import { runSubagent } from '../subagent';
import type { SubagentRunRegistry } from '../subagentRun';
import type { AgentDefinition } from '../types';

/** Match a leading `@<name>` and split the rest as the task description. */
export function parseSubagentMention(text: string): { name: string; task: string } | null {
  const match = /^\s*@([\w-]+)(?:\s+([\s\S]+))?\s*$/.exec(text);
  if (!match) return null;
  return { name: match[1] ?? '', task: (match[2] ?? '').trim() };
}

/**
 * `*` opens everything, otherwise the `subagent` tool name must be
 * explicitly listed in the agent's tool whitelist.
 */
export function agentCanDispatchSubagent(agent: AgentDefinition): boolean {
  if (agent.tools.includes('*')) return true;
  return agent.tools.includes('subagent');
}

export interface MentionDispatchDeps {
  manager: AgentManager;
  modelRef: { current: string };
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  registryRef: { current: PluginRegistryView | null };
  ctxRef: { current: PluginContext | null };
  config?: ProviderConfig;
  runRegistry: SubagentRunRegistry;
  resolveSubagentSessionPath: (runId: string) => string | undefined;
}

/**
 * Run the subagent referenced by a `@<name>` mention and queue the
 * relay-context prompt for the next turn.
 *
 * Returns `true` when dispatch happened (caller should fall through to
 * the rest of `transformUserInput`); `false` otherwise (no @-mention,
 * unknown subagent, agent forbidden, deps missing).
 */
export async function handleSubagentMention(
  text: string,
  deps: MentionDispatchDeps,
): Promise<boolean> {
  const parsed = parseSubagentMention(text);
  if (!parsed) return false;
  const subagent = deps.manager.getSubagent(parsed.name);
  if (!subagent) return false;
  // Permission gate (see header doc).
  const active = deps.manager.getActive();
  if (active && !agentCanDispatchSubagent(active)) return false;

  const ctx = deps.ctxRef.current;
  const registryView = deps.registryRef.current;
  if (!(deps.config && registryView)) return false;

  const messageBus = ctx?.messages;
  const task = parsed.task || `Use your default behaviour: ${subagent.description}`;

  // 1. Live-append the user's own message FIRST so it appears at the
  //    top of the dispatch block, then return `'continue'` so the host
  //    skips its own user-message push.
  const userMsg = await runDecorateMessageHooks(registryView.getHooks(), {
    role: 'user' as const,
    content: text,
  });
  messageBus?.append(userMsg);

  // 2. Run the subagent live. `runSubagent` emits the `↳ subagent`
  //    header through the bus's append channel by default.
  let result: { content: string; raw: string; runId: string; error: boolean };
  try {
    result = await runSubagent({
      agent: subagent,
      task,
      config: deps.config,
      model: deps.modelRef.current,
      registry: registryView,
      approvalGateway: deps.approvalGateway,
      approvalChannelId: deps.approvalChannelId,
      runRegistry: deps.runRegistry,
      messageBus: messageBus ?? null,
      resolveSessionPath: deps.resolveSubagentSessionPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[mu-agents] @-mention dispatch failed:', err);
    const failure = `Subagent '${subagent.name}' failed: ${message}`;
    result = { content: failure, raw: failure, runId: '', error: true };
  }

  // 3. Queue the relay-context prompt for the next turn so the parent
  //    LLM produces a real follow-up.
  messageBus?.injectNext(buildRelayPrompt(subagent.name, task, result.raw, result.runId));

  return true;
}

/**
 * Hidden user message dropped onto the parent's next turn. Carries the
 * subagent's raw output plus a "relay + continue" instruction.
 *
 * `display.hidden: true` keeps it out of the on-screen transcript but
 * preserves it in the LLM payload — the parent agent sees the body once
 * during the relay turn and produces a real follow-up.
 */
export function buildRelayPrompt(
  agentName: string,
  task: string,
  raw: string,
  runId: string,
): ChatMessage {
  return makeSyntheticMessage({
    role: 'user',
    content:
      '[Subagent dispatch context]\n' +
      `The "${agentName}" subagent returned the following for task ` +
      `"${task}":\n\n${raw}\n\n` +
      'Relay these findings to the user (attributing them to the ' +
      `${agentName} subagent), then continue with the user's original ` +
      'task. Take the next concrete step.',
    display: { hidden: true },
    agent: agentName,
    source: 'mu-agents.mention-dispatch.relayContext',
    subagentRunId: runId,
  });
}

// Re-export so consumers don't have to import from both modules.
export type { MessageBus };
