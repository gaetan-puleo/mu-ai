import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';

const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
let tmp: string;

function write(content: string): void {
  const muDir = join(tmp, 'mu');
  // writeFileSync does NOT create parents; do it explicitly.
  mkdirSync(muDir, { recursive: true });
  writeFileSync(join(muDir, 'config.json'), content);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mu-config-test-'));
  process.env.XDG_CONFIG_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
});

describe('loadConfig', () => {
  it('returns empty when no file exists', () => {
    expect(loadConfig()).toEqual({});
  });

  it('parses baseUrl, model, and plugins together', () => {
    write(
      JSON.stringify({
        baseUrl: 'http://example/v1',
        model: 'qwen',
        plugins: ['mu-agents', 'mu-coding-agents'],
      }),
    );
    expect(loadConfig()).toEqual({
      baseUrl: 'http://example/v1',
      model: 'qwen',
      plugins: ['mu-agents', 'mu-coding-agents'],
    });
  });

  it('plugins missing → undefined (not []), other fields preserved', () => {
    write(JSON.stringify({ model: 'qwen' }));
    const cfg = loadConfig();
    expect(cfg.model).toBe('qwen');
    expect(cfg.plugins).toBeUndefined();
  });

  it('plugins not an array → dropped silently', () => {
    write(JSON.stringify({ plugins: 'mu-agents' }));
    expect(loadConfig().plugins).toBeUndefined();
  });

  it('plugins array with non-string entries → filtered', () => {
    write(JSON.stringify({ plugins: ['mu-agents', 42, null, 'mu-coding-agents'] }));
    expect(loadConfig().plugins).toEqual(['mu-agents', 'mu-coding-agents']);
  });

  it('malformed JSON → empty config (does not throw)', () => {
    write('{ not json');
    // loadConfig writes a warning to stderr; we only assert it returns {}.
    expect(loadConfig()).toEqual({});
  });
});
