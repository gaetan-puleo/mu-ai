import type { PermissionMap } from './permissions';

/**
 * Shared agent definition. A "primary" agent owns the main session — its
 * system prompt is injected, its tool list governs which tools the LLM can
 * call. A "subagent" definition is used by the subagent / subagent_parallel
 * tools as a recipe for a one-shot nested run.
 */
export interface AgentDefinition {
  /**
   * Canonical id (frontmatter `id:`). Falls back to filename stem. Mirrored
   * to `name` for backward-compat with existing UI / persistence.
   */
  name: string;
  description: string;
  /**
   * Tool function names this agent is allowed to use, derived from the
   * `tools:` permission map (keys with non-`deny` rules). `["*"]` means
   * "no tools section in frontmatter" → all tools allowed (legacy default).
   */
  tools: string[];
  /**
   * Permission map (`tool name → action | { glob → action }`). Drives both
   * tool filtering and per-call approval prompts. Empty when the legacy
   * comma-list `tools:` form was used.
   */
  permissions?: PermissionMap;
  /** Optional hex color used to tint the per-agent UI accents. */
  color?: string;
  /** Body of the agent's system prompt. */
  systemPrompt: string;
  type: 'primary' | 'subagent';
  /** Optional `providerId/model` from frontmatter. */
  model?: string;
  /** Whether the agent is enabled (frontmatter `enabled:`, default true). */
  enabled?: boolean;
}

/** Persisted per-user state for the agent plugin. */
export interface AgentSettings {
  currentAgent?: string;
}
