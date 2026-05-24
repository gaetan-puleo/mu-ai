export type SessionState = 'idle' | 'running' | 'paused' | 'error';

export interface SessionConfig {
  system?: string;
  parentId?: string;
}
