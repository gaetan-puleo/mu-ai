import type { PermissionRule } from '../permissions/types';

export interface SubAgent {
  /** Identifier used by the `subagent` tool's `agent` arg. */
  name: string;
  /** Short description shown in the `subagent` tool's enum / system prompt. */
  description: string;
  /** System prompt body — the persona/instructions for this sub-agent. */
  prompt: string;
  /**
   * Allowed tool names (used to filter the parent's tool pool). `['*']`
   * means inherit every tool from the parent. Tools missing from this list
   * are not exposed to the sub-agent.
   *
   * When the frontmatter declares per-tool permissions (object form), the
   * tool names are derived from the map keys.
   */
  tools: string[];
  /**
   * Permission rules compiled from the frontmatter's `tools` map (object
   * form). Empty when `tools` was declared as an array. `runSubAgent`
   * applies these as a `beforeTool` hook on the sub-agent's runtime.
   */
  permissions: PermissionRule[];
  /**
   * `primary` agents are loaded as the host's main agent; `subagent` agents
   * are only invoked through the `subagent` / `subagent_parallel` tools.
   * Defaults to `subagent` when absent.
   */
  type?: 'primary' | 'subagent';
  /** Path to the .md file the sub-agent was loaded from (for diagnostics). */
  filePath: string;
  /** Optional display color (host UIs choose how to use it). */
  color?: string;
}
