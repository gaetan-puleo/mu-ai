/**
 * Client-safe subset of mu-agents.
 *
 * Excludes anything that imports Node built-ins. Mobile clients
 * (arya-companion) import from `mu-agents/client` to get snapshot types,
 * agent list shapes, and author enrichment without dragging server-only
 * dependencies (chokidar, fs, picomatch).
 */

export type {
  ApprovalRequest,
  ApprovalResult,
  ApprovalSnapshot,
  ApprovalSnapshotListener,
} from './approval';

export type {
  AgentListItem,
  AuthoredMessage,
  MessageAuthor,
  MuAgentsHandle,
  MuAgentsManager,
} from './handle';

export type {
  SubAgentRunSnapshot,
  SubagentRegistryListener,
  SubagentRun,
  SubagentRunListener,
  SubagentSnapshotListener,
  SubagentStatus,
} from './subagentRun';

export type { AgentDefinition } from './types';

export { capitalizeAgentName } from './utils/displayName';
