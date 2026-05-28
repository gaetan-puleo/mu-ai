/**
 * Harness base TUI primitives.
 *
 * Generic chat-shell building blocks that every agent's TUI builds on top
 * of: transcript model, status-line builder, approval state. These do NOT
 * render anything by themselves — rendering is each agent's job, using
 * `mu-tui` (or whatever surface they choose).
 *
 * The design pattern is composition, not inheritance: each entity exposes
 * mutable state + apply-event methods; agents wrap them in their own UI.
 */
export {
  type BaseChatLine,
  TranscriptModel,
  type TranscriptOptions,
  type ToolCallFormatter,
  type UserChatLine,
} from './transcript';
export { buildStatusParts, formatTokens, spinnerFrame, type StatusParts } from './status';
export {
  type SubAgentRun,
  type SubAgentRunListener,
  type SubAgentRunStatus,
  SubAgentRunStore,
  type SubAgentTranscriptEntry,
} from './subAgentRun';
