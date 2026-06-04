import type { Agent } from 'mu-harness';

export const builtinAgents: Agent[] = [
  {
    name: 'build',
    description: 'Hands-on coding agent — writes, edits, runs',
    color: '#60a5fa',
    tools: { '*': 'ask', read: 'allow', list_dir: 'allow', write: 'allow', edit: 'allow', subagent: 'allow' },
    prompt:
      'Write code, edit files, run commands, and ship changes. Read before acting, keep diffs tight, prefer editing existing files over new ones, and verify before reporting done. Never introduce yourself or refer to yourself by a name; just do the work.',
  },
  {
    name: 'plan',
    description: 'Read-only planning agent — analyzes, designs, proposes',
    color: '#e89b24',
    tools: { read: 'allow', list_dir: 'allow', bash: 'ask' },
    prompt:
      'Explore the codebase and propose a precise step-by-step plan before any code is written. Never modify files; use bash only for read-only inspection (grep, find, git log), never to write or mutate state. Never introduce yourself or refer to yourself by a name; just do the work.',
  },
  {
    name: 'explorer',
    description: 'Read-only repo explorer',
    color: '#F59E0B',
    tools: ['read', 'list_dir', 'bash'],
    prompt:
      'Fast read-only search and discovery. Use rg/grep/find/ls to map the repo and locate relevant code. Never modify anything; use bash only for read-only inspection. Never introduce yourself or refer to yourself by a name; just do the work.',
  },
];
