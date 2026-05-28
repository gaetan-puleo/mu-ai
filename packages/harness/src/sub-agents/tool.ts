import type { Plugin, Tool, ToolHooks, Tools } from 'mu-core';
import type { PermissionPrompt } from '../permissions/hook';
import { runSubAgent, type SubAgentRunResult } from './runner';
import type { SubAgent } from './types';

export interface SubAgentToolDeps {
  /** Source of sub-agent definitions, resolved lazily on each call so reload works. */
  getSubAgents: () => SubAgent[];
  /** Tool pool the sub-agent picks from (filtered by its allow list). */
  getTools: () => Tools;
  /** Plugins forwarded to the sub-agent (provider, lifecycle, plugin tools). */
  getPlugins: () => Plugin[];
  /** Optional hooks forwarded to the sub-agent runtime (e.g. permission gates). */
  getHooks?: () => ToolHooks | undefined;
  /**
   * Approval prompt forwarded to `runSubAgent` so each sub-agent's `ask`
   * permissions reach the host UI.
   */
  approvalPrompt?: PermissionPrompt;
  /** Optional system prompt prefix prepended before the sub-agent's body. */
  getSystemPromptPrefix?: () => string | undefined;
}

interface SubAgentArgs {
  agent?: unknown;
  task?: unknown;
}

interface SubAgentParallelArgs {
  runs?: unknown;
}

/**
 * The single-call delegation tool. The model calls
 *   `subagent({ agent: "explorer", task: "find all usages of X" })`
 * to fire off one isolated sub-run and get its final answer back.
 */
export function createSubAgentTool(deps: SubAgentToolDeps): Tool<SubAgentArgs, string> {
  return {
    name: 'subagent',
    description: 'Delegate an isolated task to a named sub-agent. Returns the sub-agent\'s final answer.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Sub-agent name (see system prompt for the list).' },
        task: { type: 'string', description: 'The task to delegate.' },
      },
      required: ['agent', 'task'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const agentName = typeof args.agent === 'string' ? args.agent : '';
      const task = typeof args.task === 'string' ? args.task : '';
      if (!(agentName && task)) {
        return 'Error: subagent requires both `agent` and `task`.';
      }
      const subAgent = deps.getSubAgents().find((a) => a.name === agentName);
      if (!subAgent) {
        return `Error: unknown sub-agent "${agentName}".`;
      }
      const result = await runSubAgent({
        subAgent,
        prompt: task,
        tools: deps.getTools(),
        plugins: deps.getPlugins(),
        hooks: deps.getHooks?.(),
        approvalPrompt: deps.approvalPrompt,
        systemPromptPrefix: deps.getSystemPromptPrefix?.(),
      });
      return formatSubAgentReplyForParent({
        agentName: result.agentName,
        task,
        content: result.content,
        error: result.status === 'failed' ? result.error : undefined,
      });
    },
    onError: (error) => `subagent failed: ${error instanceof Error ? error.message : String(error)}`,
  };
}

/**
 * The fan-out delegation tool. The model calls
 *   `subagent_parallel({ runs: [{ agent: "a", task: "..." }, { agent: "b", task: "..." }] })`
 * and gets a Markdown-separated aggregate of every sub-run's result.
 */
export function createSubAgentParallelTool(deps: SubAgentToolDeps): Tool<SubAgentParallelArgs, string> {
  return {
    name: 'subagent_parallel',
    description: 'Fan out N sub-agents in parallel. Returns every result aggregated.',
    parameters: {
      type: 'object',
      properties: {
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string' },
              task: { type: 'string' },
            },
            required: ['agent', 'task'],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ['runs'],
      additionalProperties: false,
    },
    execute: async (args) => {
      if (!Array.isArray(args.runs)) {
        return 'Error: subagent_parallel could not parse arguments (missing or non-array `runs`).';
      }
      const runs = args.runs.map((r) => {
        const item = r as { agent?: unknown; task?: unknown };
        return {
          agent: typeof item.agent === 'string' ? item.agent : '',
          task: typeof item.task === 'string' ? item.task : '',
        };
      });
      if (runs.length === 0) {
        return 'Error: subagent_parallel requires at least one run.';
      }

      const subAgents = deps.getSubAgents();
      const tools = deps.getTools();
      const plugins = deps.getPlugins();
      const hooks = deps.getHooks?.();
      const systemPromptPrefix = deps.getSystemPromptPrefix?.();

      const results = await Promise.all(
        runs.map(async (run): Promise<SubAgentRunResult> => {
          const subAgent = subAgents.find((a) => a.name === run.agent);
          if (!subAgent) {
            const errMsg = `unknown sub-agent "${run.agent}"`;
            return {
              status: 'failed',
              agentName: run.agent,
              content: '',
              error: errMsg,
              errors: [errMsg],
            };
          }
          return runSubAgent({
            subAgent,
            prompt: run.task,
            tools,
            plugins,
            hooks,
            approvalPrompt: deps.approvalPrompt,
            systemPromptPrefix,
          });
        }),
      );

      return results
        .map((r, i) =>
          formatSubAgentReplyForParent({
            agentName: r.agentName,
            task: runs[i]?.task ?? '',
            content: r.content,
            error: r.status === 'failed' ? r.error : undefined,
          })
        )
        .join('\n\n===\n\n');
    },
    onError: (error) => `subagent_parallel failed: ${error instanceof Error ? error.message : String(error)}`,
  };
}

/**
 * Wrap a sub-agent's reply with a short instruction telling the caller that
 * this is NOT a user-authored turn but a delegated agent's answer that needs
 * to be reviewed and acted on. Use this when feeding a sub-agent's result back
 * to a parent runtime (e.g. via `bus.publish({ type: 'user_message', ... })`),
 * so the parent doesn't mistakenly reply *to* the sub-agent.
 *
 * The framing intentionally mirrors what the `subagent` tool already produces
 * as its tool-result content, so the parent treats it identically whether the
 * dispatch was tool-initiated or user-initiated.
 */
export function formatSubAgentReplyForParent(opts: {
  agentName: string;
  task: string;
  content: string;
  error?: string;
}): string {
  const header = opts.error
    ? `[sub-agent @${opts.agentName} — task: "${opts.task}" — FAILED]`
    : `[sub-agent @${opts.agentName} — task: "${opts.task}"]`;
  const instruction = opts.error
    ? 'Review the failure below and decide the next step (retry, fix the inputs, or proceed without it). Do not address the sub-agent directly.'
    : 'Review the sub-agent\'s answer below. Treat it as research/data — incorporate it into your next reply to the user, do not address the sub-agent directly.';
  const body = opts.error ? `Error: ${opts.error}\n\n${opts.content}` : opts.content;
  return `${header}\n\n${instruction}\n\n---\n\n${body}`;
}
