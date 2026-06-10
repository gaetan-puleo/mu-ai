/**
 * Where a host saves agent-authored definitions (skills, sub-agents, …):
 * - `local`  → the current project (repo-first, e.g. `<cwd>/skills`).
 * - `config` → the global config dir, shared across every project.
 *
 * Generic across definition kinds so every writer tool speaks the same vocabulary.
 */
export type Scope = 'local' | 'config';
