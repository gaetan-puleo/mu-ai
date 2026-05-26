/**
 * Helpers for selecting and applying a "primary" sub-agent — the agent that
 * drives the root runtime (as opposed to dispatcher-style sub-agents).
 */
import type { Tools } from 'mu-core';
import type { SubAgent } from './types';

/**
 * Pick the primary agent from a loaded set. Preference:
 *   1. The agent explicitly tagged `type: primary`.
 *   2. The only agent in the list (when there's exactly one).
 *   3. `undefined`.
 */
export function pickPrimaryAgent(agents: SubAgent[]): SubAgent | undefined {
  const explicit = agents.find((a) => a.type === 'primary');
  if (explicit) return explicit;
  return agents.length === 1 ? agents[0] : undefined;
}

/**
 * Filter a tools map down to the names allowed by the primary agent. When
 * the agent's `tools` array contains `*`, every tool is kept. When there is
 * no primary, every tool is kept too.
 */
export function filterToolsByPrimary(tools: Tools, primary: SubAgent | undefined): Tools {
  if (!primary || primary.tools.includes('*')) return tools;
  const allow = new Set(primary.tools);
  const out: Tools = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (allow.has(name)) out[name] = tool;
  }
  return out;
}
