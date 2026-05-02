import type { AgentDefinition } from './types';

/**
 * Built-in primary agents shipped with the plugin. Users override them by
 * dropping a same-name `.md` file in `~/.config/mu/agents/`.
 *
 * Tool names match the actual tools registered by `mu-coding-tools` (read,
 * write, edit, bash) plus `search_code` from `mu-repomap` and the subagent
 * tools from this plugin.
 */
export const DEFAULT_PRIMARY_AGENTS: AgentDefinition[] = [
  {
    name: 'build',
    description: 'Execute code changes, run commands, write files',
    tools: ['bash', 'read', 'write', 'edit', 'search_code', 'subagent', 'subagent_parallel'],
    permissions: {
      bash: 'allow',
      read: 'allow',
      write: 'allow',
      edit: 'allow',
      search_code: 'allow',
      subagent: 'allow',
      subagent_parallel: 'allow',
    },
    color: '#3498db',
    systemPrompt: [
      'You are the **build** agent. You can read & edit files, run shell commands, and dispatch subagents.',
      '',
      '- Prefer `edit` for surgical changes; use `write` only for new files or full rewrites.',
      '- Run tests / scripts via `bash`.',
      '- Delegate isolated reviews to subagents when useful.',
    ].join('\n'),
    type: 'primary',
  },
  {
    name: 'plan',
    description: 'Plan and analyse tasks, read-only operations',
    tools: ['read', 'search_code'],
    permissions: {
      read: 'allow',
      search_code: 'allow',
    },
    color: '#9b59b6',
    systemPrompt: [
      'You are the **plan** agent. You operate in **read-only** mode.',
      '',
      'Your role:',
      '- Analyse requirements and the existing codebase.',
      '- Read files and search symbols to gather context.',
      '- Produce concrete plans, recommendations, or design notes.',
      '',
      'Do NOT modify files or run shell commands. The host enforces this — calls to forbidden tools will be rejected.',
    ].join('\n'),
    type: 'primary',
  },
];

/**
 * Built-in subagents. Empty by default; users can ship their own via
 * `~/.config/mu/agents/<name>.md` with `agent: subagent` in the frontmatter.
 */
export const DEFAULT_SUB_AGENTS: AgentDefinition[] = [
  {
    name: 'review',
    description: 'Review the most recent changes for issues',
    tools: ['read', 'search_code', 'bash'],
    permissions: {
      read: 'allow',
      search_code: 'allow',
      bash: { 'git diff*': 'allow', 'git log*': 'allow', 'git show*': 'allow', '*': 'ask' },
    },
    color: '#27ae60',
    systemPrompt: [
      'You are the **review** subagent. Your task is to review code changes for correctness and style.',
      '',
      '- Inspect the recent diff (use `bash` with `git diff` if helpful).',
      '- Flag bugs, missing error handling, and style issues.',
      '- Reply with a concise bulleted summary; no preamble.',
    ].join('\n'),
    type: 'subagent',
  },
];
