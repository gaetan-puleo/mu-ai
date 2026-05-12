/**
 * Canonical `customType` identifiers mu-agents stamps on synthetic
 * messages. Pulled out of `renderers.tsx` so the constants can be
 * consumed by non-renderer code without dragging React/Ink in.
 *
 * The renderer module (now in `mu-coding`) imports these to register
 * its message renderer; mu-agents internals stamp them on synthetic
 * messages.
 */

const MESSAGE_TYPE_SUBAGENT = 'mu-agents.subagent';

export const AGENT_MESSAGE_TYPES = {
  subagent: MESSAGE_TYPE_SUBAGENT,
} as const;
