/**
 * Pre-wire `runSubAgent` with the tools/plugins/approval-queue assembled by
 * `bootstrap()` so hosts can dispatch a sub-agent by name without threading
 * the inputs themselves.
 *
 * The dispatcher returns the same `{ content, error }` shape coding-agent
 * already expects, so the UI layer (ChatApp / SubAgentController) doesn't
 * have to know about `SubAgentRunResult` discriminants.
 */
import type { CoreEvent, Plugin, Tools } from 'mu-core';
import { type ApprovalQueue, approvalQueueToPrompt } from '../approvals/queue';
import { runSubAgent } from './runner';
import type { SubAgent } from './types';

export interface DispatchSubAgentResult {
  content: string;
  error?: string;
}

export type DispatchSubAgentFn = (
  name: string,
  task: string,
  onEvent?: (event: CoreEvent) => void,
) => Promise<DispatchSubAgentResult>;

export interface CreateSubAgentDispatcherOptions {
  /** Available sub-agents (typically `BootstrapResult.subAgents`). */
  subAgents: SubAgent[];
  /** Full tool pool — `runSubAgent` filters by the sub-agent's allow-list. */
  tools: Tools;
  /** Inherited plugins (provider + lifecycle). */
  plugins: Plugin[];
  /** Approval queue whose `prompt` is invoked when a sub-agent's permission rule asks. */
  approvalQueue: ApprovalQueue;
}

export function createSubAgentDispatcher(opts: CreateSubAgentDispatcherOptions): DispatchSubAgentFn {
  const byName = new Map(opts.subAgents.map((a) => [a.name, a] as const));
  return async (name, task, onEvent) => {
    const subAgent = byName.get(name);
    if (!subAgent) return { content: '', error: `Unknown sub-agent "${name}"` };
    const run = await runSubAgent({
      subAgent,
      prompt: task,
      tools: opts.tools,
      plugins: opts.plugins,
      approvalPrompt: approvalQueueToPrompt(opts.approvalQueue),
      onEvent,
    });
    return { content: run.content, error: run.status === 'failed' ? run.error : undefined };
  };
}
