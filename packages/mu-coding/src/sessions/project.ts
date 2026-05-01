import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function findGitRoot(from: string): string | null {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: from,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

// The project root is determined once per process — `process.cwd()` doesn't
// move during a TUI session and shelling out to git on every save is wasteful.
let cachedRoot: string | null = null;

function getProjectRoot(): string {
  if (cachedRoot !== null) {
    return cachedRoot;
  }
  const cwd = process.cwd();
  cachedRoot = findGitRoot(cwd) ?? cwd;
  return cachedRoot;
}

let cachedId: string | null = null;
let cachedName: string | null = null;

export function getProjectId(): string {
  if (cachedId !== null) {
    return cachedId;
  }
  const root = getProjectRoot();
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const name = root.split('/').pop() || 'unknown';
  cachedId = `${name}-${hash}`;
  return cachedId;
}

export function getProjectName(): string {
  if (cachedName !== null) {
    return cachedName;
  }
  const root = getProjectRoot();
  cachedName = root.split('/').pop() || root;
  return cachedName;
}
