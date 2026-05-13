import type { Agent } from './markdown';

// Strict: '@' must be at position 0. No leading whitespace. Agent name uses
// alphanumerics, dash, underscore. Optional task is whatever follows the first
// whitespace separator. The /s flag lets `.` cross newlines for the task body.
const LEADING_MENTION = /^@([\w-]+)(?:\s+([\s\S]*))?$/;

export interface ParsedMention {
  /** Original text, unchanged. */
  raw: string;
  /** Text the LLM should see. `''` when only the mention was typed. */
  cleaned: string;
  /** Recognised mention, when present. */
  mention?: { agent: string; task: string };
}

/**
 * Parse a user message for a single leading `@agent` mention.
 *
 *   "@plan refactor X"    → { mention: { agent: 'plan', task: 'refactor X' }, cleaned: 'refactor X' }
 *   "@plan"               → { mention: { agent: 'plan', task: '' },          cleaned: '' }
 *   "please @plan ..."    → no mention (not at position 0)
 *   "@unknown ..."        → no mention (name not in knownAgents)
 */
export function parseMention(text: string, knownAgents: Set<string>): ParsedMention {
  const match = text.match(LEADING_MENTION);
  if (!match) return { raw: text, cleaned: text };
  const [, agent, rest] = match;
  if (!agent || !knownAgents.has(agent)) return { raw: text, cleaned: text };
  const task = (rest ?? '').trim();
  return {
    raw: text,
    cleaned: task,
    mention: { agent, task },
  };
}

export interface MentionCompletion {
  value: string;
  label?: string;
  description?: string;
}

export function createAgentCompletions(
  agents: () => Agent[],
): (partial: string) => MentionCompletion[] {
  return (partial) => {
    const prefix = partial.toLowerCase();
    return agents()
      .filter((a) => a.name.toLowerCase().startsWith(prefix))
      .map((a) => ({
        value: a.name,
        label: a.name,
        description: a.description || undefined,
      }));
  };
}
