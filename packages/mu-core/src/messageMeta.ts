/**
 * Strict typing for `ChatMessage.meta`.
 *
 * Every recognised key is declared here. Extensions live via module
 * augmentation:
 *
 *   declare module 'mu-core' {
 *     interface ChatMessageMeta {
 *       myPluginKey?: string;
 *     }
 *   }
 *
 * No index signature — typo'd keys fail compile rather than silently
 * landing in the JSONL. mu-core is the single source of truth for known
 * meta keys.
 */

export interface ChatMessageMeta {
  /** Stable id allocated by the host or factory. */
  id?: string;
  /** Creation timestamp (epoch ms). */
  ts?: number;
  /**
   * Agent name attributed to this message. Canonical key — used by
   * mu-agents' `stampActiveAgent` decorate hook AND by host message
   * factories. Renamed from the legacy `agentId`.
   */
  agent?: string;
  /** Pretty-printed JSON of tool call args, for display. */
  toolArgs?: string;
  /** Provenance tag for synthetic messages (e.g. 'mu-agents.mention-dispatch'). */
  source?: string;
  /** Correlates a message back to a `SubagentRun`. */
  subagentRunId?: string;
  /**
   * Marks a synthetic message as render-only. `attachAutoPersist` skips
   * persistence for messages flagged transient — used by mu-agents'
   * subagent header and @-mention echo so those entries stay in
   * `session.messages` (for live render + LLM context filtering via
   * `display.llmHidden`) but do NOT land on disk.
   */
  transient?: boolean;
}

/**
 * Canonical key constants for direct property access elsewhere in
 * mu-core / mu-agents. Use when string literals would otherwise drift.
 */
export const META_KEYS = {
  id: 'id',
  ts: 'ts',
  agent: 'agent',
  toolArgs: 'toolArgs',
  source: 'source',
  subagentRunId: 'subagentRunId',
  transient: 'transient',
} as const satisfies Record<keyof ChatMessageMeta, keyof ChatMessageMeta>;
