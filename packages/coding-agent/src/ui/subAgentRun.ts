/**
 * Re-export the harness sub-agent-run model so existing TUI components keep
 * their imports stable. The implementation lives in mu-harness; this file is
 * a compatibility shim while consumers migrate to importing directly.
 */
export {
  type SubAgentRun,
  type SubAgentRunListener,
  type SubAgentRunStatus,
  SubAgentRunStore,
  type SubAgentTranscriptEntry,
} from 'mu-harness';
