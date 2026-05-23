export type SessionState = 'idle' | 'running' | 'paused' | 'error';

export type SessionConfig = {
  system?: string;
  parentId?: string;
};
