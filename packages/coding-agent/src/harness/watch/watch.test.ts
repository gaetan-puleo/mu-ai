import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watchDefinitions } from './index';

describe('watchDefinitions', () => {
  it('fires onChange (debounced) when a watched file is created', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mu-watch-'));
    let calls = 0;
    const watcher = watchDefinitions({ dirs: [dir], onChange: () => void calls++, debounceMs: 50 });
    try {
      await writeFile(`${dir}/a.md`, 'x');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ensureDirs creates a missing dir so it becomes watchable', async () => {
    const base = await mkdtemp(join(tmpdir(), 'mu-watch-'));
    const missing = join(base, 'later');
    let calls = 0;
    const watcher = watchDefinitions({ dirs: [missing], onChange: () => void calls++, debounceMs: 50 });
    try {
      await writeFile(`${missing}/b.md`, 'x');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
      await rm(base, { recursive: true, force: true });
    }
  });

  it('ignores files matched by the ignore predicate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mu-watch-'));
    let calls = 0;
    const watcher = watchDefinitions({
      dirs: [dir],
      onChange: () => void calls++,
      debounceMs: 50,
      ignore: (f) => f.endsWith('state.json'),
    });
    try {
      await writeFile(`${dir}/state.json`, '{}');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls).toBe(0);
      await writeFile(`${dir}/agent.md`, 'x');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips non-existent paths without throwing when ensureDirs is false', () => {
    const watcher = watchDefinitions({
      dirs: ['/no/such/dir/xyz-mu-watch'],
      onChange: () => {},
      ensureDirs: false,
    });
    watcher.stop();
    expect(true).toBe(true);
  });
});
