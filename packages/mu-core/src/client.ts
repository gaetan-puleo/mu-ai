/**
 * Browser / RN-safe subset of mu-core.
 *
 * Excludes anything that imports Node built-ins (fs, path, os).
 * Channel clients (arya-companion, future web frontend) import from
 * `mu-core/client` to get the message projection + utility helpers
 * without dragging the server-only session store / plugin loader.
 *
 * If you add an export here, audit its transitive imports for `node:*`
 * specifiers first.
 */

export { newMessageId, newSessionId, newTaskSessionId, nowMs } from './ids';
export type {
  AssistantMessageOpts,
  SyntheticMessageOpts,
  ToolMessageInput,
  UserMessageOpts,
} from './messageFactories';
export {
  makeAssistantMessage,
  makeSyntheticMessage,
  makeToolMessage,
  makeUserMessage,
} from './messageFactories';
// Pure types — no runtime imports.
export type { ChatMessageMeta } from './messageMeta';
export { META_KEYS } from './messageMeta';
export type { MessageDisplayRow } from './projectMessage';
export { projectMessage } from './projectMessage';
export type { SessionGroup, SessionGroupLabel } from './sessionStore/grouping';
export { formatRelativeTime, groupByDate } from './sessionStore/grouping';
// Session store TYPES (no runtime — types-only, safe to import).
export type {
  SessionChangeKind,
  SessionChangeListener,
  SessionStore,
  SessionSummary,
  StoredSession,
} from './sessionStore/types';
export type {
  ApiModel,
  ChatMessage,
  ImageAttachment,
  MessageDisplay,
  ProviderConfig,
  StreamChunk,
  StreamOptions,
  ToolCall,
  ToolDefinition,
  ToolResultInfo,
  Usage,
} from './types/llm';
export { formatDuration } from './utils/duration';
export { prettyToolArgs } from './utils/prettyArgs';
export { readMetaNumber, readMetaString } from './utils/readMeta';
