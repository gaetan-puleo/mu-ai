/**
 * Regression test for the runSg "no matches" handling.
 *
 * ast-grep follows ripgrep/grep semantics: exit code 1 means "no matches",
 * not "scan failed". Before this fix, scanDeclarations() would surface a
 * spurious `[repomap] ast-grep scan failed` toast any time a DECL pattern
 * yielded zero matches, or when mu was launched with a cwd containing no
 * source files (e.g. `~/.config/mu`).
 *
 * We exercise the fix end-to-end via the public buildRepomap() — running
 * it on a directory with no source files should resolve cleanly with an
 * empty file set and surface no error notifications.
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepomapLogger } from './logger';
import { buildRepomap } from './repomap';

const here = dirname(fileURLToPath(import.meta.url));

function hasSg(): boolean {
  const candidate = join(here, '..', 'node_modules', '.bin', 'sg');
  if (!existsSync(candidate)) return false;
  try {
    execFileSync(candidate, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

interface CapturedNotify {
  message: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

function makeRecordingLogger(): { logger: RepomapLogger; notifications: CapturedNotify[] } {
  const notifications: CapturedNotify[] = [];
  return {
    notifications,
    logger: {
      // No-op progress sinks — we only assert on `notify` calls.
      progress: () => {
        /* swallow */
      },
      clearProgress: () => {
        /* swallow */
      },
      notify: (message, level) => notifications.push({ message, level }),
    },
  };
}

describe('runSg exit-code-1 handling', () => {
  it('treats "no matches" (sg exit 1) as success on a dir with no source files', async () => {
    if (!hasSg()) return; // ast-grep not installed in this env — degrade gracefully.

    const dir = mkdtempSync(join(tmpdir(), 'mu-repomap-test-'));
    try {
      // README.md is not in SOURCE_EXTS — sg will return exit 1 + `[]`
      // for every DECL_PATTERNS entry, exercising the "no matches" path.
      writeFileSync(join(dir, 'README.md'), '# nothing to scan\n', 'utf-8');

      const { logger, notifications } = makeRecordingLogger();
      const map = await buildRepomap(dir, true, logger);

      expect(map.files.size).toBe(0);
      const errors = notifications.filter((n) => n.level === 'error');
      expect(errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still produces a non-empty map when matches exist (smoke check on a small fixture)', async () => {
    if (!hasSg()) return;

    const dir = mkdtempSync(join(tmpdir(), 'mu-repomap-test-'));
    try {
      // One real source file with a single export — at least one
      // DECL_PATTERNS entry yields matches (exit 0), the rest yield none
      // (exit 1, swallowed by the fix). Final symbol set should be a
      // singleton, no error notifications.
      // Plain string concat — `return "hi " + name` keeps the fixture as
      // valid TypeScript that ast-grep parses, without tripping biome's
      // noTemplateCurlyInString rule (which would fire on `${name}` even
      // when nested inside a backtick literal in a single-quoted host).
      const fixture = ['export function hello(name: string): string {', '  return "hi " + name;', '}', ''].join('\n');
      writeFileSync(join(dir, 'lib.ts'), fixture, 'utf-8');

      const { logger, notifications } = makeRecordingLogger();
      const map = await buildRepomap(dir, true, logger);

      expect(map.files.size).toBeGreaterThan(0);
      const errors = notifications.filter((n) => n.level === 'error');
      expect(errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
