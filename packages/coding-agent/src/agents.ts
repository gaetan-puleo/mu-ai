import type { Agent } from './harness';

// Sub-agents only: the main coding agent is a single full-surface agent (no persona
// cycle). These are delegated to via the `subagent` tool.
export const builtinAgents: Agent[] = [
  {
    name: 'explorer',
    description: 'Read-only — fast code search and discovery. Delegate to locate code or learn how something works.',
    color: '#F59E0B',
    tools: { read: 'allow', list: 'allow', bash: 'allow' },
    bashReadOnly: true,
    variant: 'minimal',
    prompt:
      'Fast read-only search and discovery. Use rg/grep/find/ls to locate the code relevant to the task; never modify anything and use bash for read-only inspection only. End with one report, written for an agent who has not seen the repo: (1) a 1-2 sentence answer to the task; (2) the relevant `path:line` locations, each with a one-line note on what lives there; (3) how they connect — the call/data flow between them; (4) entry points or gotchas the next agent must know. Cite `path:line` rather than pasting file bodies, include only load-bearing code, and stop as soon as the task is answered.',
  },
  {
    name: 'reviewer',
    description: 'Read-only — critiques a diff or file for one concern. Delegate to get focused review findings back.',
    color: '#a78bfa',
    tools: { read: 'allow', list: 'allow', bash: 'allow' },
    bashReadOnly: true,
    variant: 'low',
    prompt:
      'Read-only critic. You are given one concern (correctness, spec-conformance, or repo standards) and a scope (a diff range or a set of files). Inspect only what the concern needs — read the diff, the touched files, and any standards docs you were pointed at; never modify anything and use bash for read-only inspection only (git diff/log/show, rg, ls). Report only real, load-bearing findings: each as `path:line` + one line stating the problem and why it matters, ordered worst first. Separate hard defects from judgement calls. Skip anything a formatter or type-checker already enforces. If the scope is clean, say so in one line. Be terse; cite locations, do not paste file bodies.',
  },
];
