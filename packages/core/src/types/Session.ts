export type SessionState = 'idle' | 'running' | 'stopped';

export interface SessionConfig {
  system?: string;
  parentId?: string;
}
