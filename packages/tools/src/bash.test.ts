import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentPart } from 'mu-core';
import { createBashTool } from './bash';

const textOf = (parts: ContentPart[]): string => parts.map((part) => (part.type === 'text' ? part.text : '')).join('');

describe('bash tool', () => {
  it('returns the standard output of the command', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-stdout-'));
    try {
      const tool = createBashTool({ getCwd: () => cwd });
      const result = textOf(await tool.run({ cmd: 'echo hello' }, {}));
      expect(result).toContain('hello');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('caps standard output at maxOutputBytes and reports truncation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-cap-'));
    try {
      const tool = createBashTool({ getCwd: () => cwd, maxOutputBytes: 1024 });
      const result = textOf(await tool.run({ cmd: 'yes' }, {}));
      expect(result).toContain('truncated');
      expect(result.length).toBeLessThan(4096);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('aborts when ctx.signal fires', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-abort-'));
    try {
      const ctrl = new AbortController();
      const tool = createBashTool({ getCwd: () => cwd });
      const promise = tool.run({ cmd: 'sleep 30' }, { signal: ctrl.signal });
      setTimeout(() => ctrl.abort(), 50);
      const result = textOf(await promise);
      expect(result).toContain('aborted');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('still honors the legacy getAbortSignal fallback when ctx is absent', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-abort-legacy-'));
    try {
      const ctrl = new AbortController();
      const tool = createBashTool({
        getCwd: () => cwd,
        getAbortSignal: () => ctrl.signal,
      });
      const promise = tool.run({ cmd: 'sleep 30' }, {});
      setTimeout(() => ctrl.abort(), 50);
      const result = textOf(await promise);
      expect(result).toContain('aborted');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a non-string cmd with an error string', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bash-bad-cmd-'));
    try {
      const tool = createBashTool({ getCwd: () => cwd });
      const result = textOf(await tool.run({ cmd: 123 as unknown as string }, {}));
      expect(result).toContain('Error:');
      expect(result).toContain('string `cmd`');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
