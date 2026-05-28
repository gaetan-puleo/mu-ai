/**
 * Bare-`@name` routing for user-submitted messages. Distinct from the
 * inline-prompt-expansion `@prefix:target` syntax handled by `MentionEngine`:
 *
 *   "@build refactor X"     → route the next turn through the `build` primary
 *   "@reviewer audit Y"     → dispatch the `reviewer` sub-agent in isolation
 *   "no agent prefix here"  → normal message
 *
 * Hosts feed this the lists of primaries and sub-agents they already have
 * loaded (matching is case-insensitive). The returned shape is what
 * ChatApp's submit handler discriminates on.
 */
import type { SubAgent } from './types';

export type AgentRouting<T extends NamedAgent = SubAgent> =
  | { kind: 'none' }
  | { kind: 'override'; agent: T }
  | { kind: 'dispatch'; agent: T; task: string };

export interface NamedAgent {
  name: string;
}

export interface ParseAgentRoutingOptions<T extends NamedAgent = SubAgent> {
  /** Switchable primary agents — when matched, the message routes via override. */
  primaryAgents?: readonly T[];
  /** Sub-agents — when matched, the message routes via isolated dispatch. */
  subAgents?: readonly T[];
}

const MENTION = /@([a-zA-Z_][\w-]*)/;

export function parseAgentRouting<T extends NamedAgent = SubAgent>(
  text: string,
  opts: ParseAgentRoutingOptions<T>,
): AgentRouting<T> {
  const match = text.match(MENTION);
  if (!match) return { kind: 'none' };
  const lowered = match[1].toLowerCase();

  const primary = (opts.primaryAgents ?? []).find((a) => a.name.toLowerCase() === lowered);
  if (primary) return { kind: 'override', agent: primary };

  const sub = (opts.subAgents ?? []).find((a) => a.name.toLowerCase() === lowered);
  if (sub) {
    const stripped = text.replace(new RegExp(`@${match[1]}\\s*`, 'i'), '').trim();
    return { kind: 'dispatch', agent: sub, task: stripped || text };
  }

  return { kind: 'none' };
}
