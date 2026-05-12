import type { AgentDefinition } from './types';

/**
 * `mu-agents` ships **no** built-in agents on its own. It's a generic
 * agent-switching / permissions / approval runtime — hosts plug in their
 * own agents either by:
 *
 *  - dropping markdown files in their configured `agentsDir`, or
 *  - registering a domain-specific plugin like `mu-coding-agents`, which
 *    contributes the `build` / `plan` / `explore` / `review` defaults.
 *
 * These arrays remain exported (empty) for backwards-compatible imports.
 */
export const DEFAULT_PRIMARY_AGENTS: AgentDefinition[] = [];

export const DEFAULT_SUB_AGENTS: AgentDefinition[] = [];
