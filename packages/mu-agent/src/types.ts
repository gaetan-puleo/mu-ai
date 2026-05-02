/**
 * Shared agent definition. A "primary" agent owns the main session — its
 * system prompt is injected, its tool list governs which tools the LLM can
 * call. A "subagent" definition is used by the subagent / subagent_parallel
 * tools as a recipe for a one-shot nested run.
 */
export interface AgentDefinition {
  name: string;
  description: string;
  /** Tool function names this agent is allowed to use. `["*"]` means "all". */
  tools: string[];
  /** Optional hex color used to tint the per-agent UI accents. */
  color?: string;
  /** Body of the agent's system prompt. */
  systemPrompt: string;
  type: 'primary' | 'subagent';
}

/** Persisted per-user state for the agent plugin. */
export interface AgentSettings {
  currentAgent?: string;
}
