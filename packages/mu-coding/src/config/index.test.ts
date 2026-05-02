import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Important: stub XDG_CONFIG_HOME *before* importing './index' so the module
// captures the test paths in its top-level constants. Bun resolves dynamic
// imports per-call, so we use `await import` inside each test.
let tmpRoot: string;
let configPath: string;
let originalConfigHome: string | undefined;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'mu-config-'));
  originalConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpRoot;
  mkdirSync(join(tmpRoot, 'mu'), { recursive: true });
  configPath = join(tmpRoot, 'mu', 'config.json');
});

afterAll(() => {
  if (originalConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalConfigHome;
  }
});

describe('saveConfig', () => {
  it('preserves unknown keys in config.json', async () => {
    const { saveConfig } = await import('./index');

    // Seed with a custom key the loader doesn't know about.
    writeFileSync(configPath, JSON.stringify({ baseUrl: 'http://x', customKey: 42 }, null, 2));

    saveConfig({ model: 'qwen' });

    const persisted = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(persisted.customKey).toBe(42);
    expect(persisted.model).toBe('qwen');
    expect(persisted.baseUrl).toBe('http://x');
  });

  it('removes a key when explicitly set to undefined', async () => {
    const { saveConfig } = await import('./index');
    writeFileSync(configPath, JSON.stringify({ model: 'before' }));
    saveConfig({ model: undefined });
    const persisted = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect('model' in persisted).toBe(false);
  });
});

describe('loadConfig theme', () => {
  it('reads the theme field from config.json', async () => {
    const { loadConfig } = await import('./index');
    writeFileSync(
      configPath,
      JSON.stringify({ baseUrl: 'http://x', theme: { preset: 'light', input: { cursor: '#abcdef' } } }),
    );
    const cfg = loadConfig();
    expect(cfg.theme).toEqual({ preset: 'light', input: { cursor: '#abcdef' } });
  });

  it('accepts a preset name string', async () => {
    const { loadConfig } = await import('./index');
    writeFileSync(configPath, JSON.stringify({ baseUrl: 'http://x', theme: 'solarized-dark' }));
    const cfg = loadConfig();
    expect(cfg.theme).toBe('solarized-dark');
  });

  it('omits theme when not present', async () => {
    const { loadConfig } = await import('./index');
    writeFileSync(configPath, JSON.stringify({ baseUrl: 'http://x' }));
    const cfg = loadConfig();
    expect(cfg.theme).toBeUndefined();
  });
});
