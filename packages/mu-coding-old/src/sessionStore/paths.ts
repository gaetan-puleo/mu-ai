import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the directory where session JSONL files are kept.
 *
 * Honours `$XDG_DATA_HOME` (XDG Base Directory Specification) and falls back
 * to `~/.local/share/mu/sessions/` — matching what mu-coding's README has
 * advertised since the host's first commit.
 *
 * The directory is NOT created here; callers (only `attachAutoPersist` today)
 * do that lazily so unit tests that never write a session don't litter the
 * user's data dir.
 */
export function getSessionsDir(): string {
  const base = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'mu')
    : join(homedir(), '.local', 'share', 'mu');
  return join(base, 'sessions');
}

export function sessionFilePath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.jsonl`);
}
