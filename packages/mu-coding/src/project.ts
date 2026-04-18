import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function findGitRoot(from: string): string | null {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: from,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

function getProjectRoot(): string {
  const cwd = process.cwd();
  return findGitRoot(cwd) ?? cwd;
}

export function getProjectId(): string {
  const root = getProjectRoot();
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const name = root.split('/').pop() || 'unknown';
  return `${name}-${hash}`;
}

export function getProjectName(): string {
  const root = getProjectRoot();
  return root.split('/').pop() || root;
}
