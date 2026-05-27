import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashTool } from './bash';

describe('bash tool', () => {
  it('returns command stdout', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-stdout-'));
    try {
      const tool = createBashTool({ getCwd: () => cwd });
      const result = await tool.execute(JSON.stringify({ cmd: 'echo hello' }));
      expect(result).toContain('hello');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('caps stdout at maxOutputBytes and reports truncation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-cap-'));
    try {
      const tool = createBashTool({ getCwd: () => cwd, maxOutputBytes: 1024 });
      // `yes` would run unbounded; the cap should kill it and append the marker.
      const result = await tool.execute(JSON.stringify({ cmd: 'yes' }));
      expect(result).toContain('truncated');
      // The total result should be small (bounded by 1 KiB plus marker + framing).
      expect(result.length).toBeLessThan(4096);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('aborts when the abort signal fires', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-abort-'));
    try {
      const ctrl = new AbortController();
      const tool = createBashTool({
        getCwd: () => cwd,
        getAbortSignal: () => ctrl.signal,
      });
      const promise = tool.execute(JSON.stringify({ cmd: 'sleep 30' }));
      // Give spawn a moment, then abort.
      setTimeout(() => ctrl.abort(), 50);
      const result = await promise;
      expect(result).toContain('aborted');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('respects restrictToCwd by anchoring relative paths', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-restrict-'));
    try {
      const tool = createBashTool({ getCwd: () => cwd, restrictToCwd: true });
      // `pwd` should be the contained cwd, even if the user tries `cd /` first.
      const result = await tool.execute(JSON.stringify({ cmd: 'pwd' }));
      expect(result).toContain(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
