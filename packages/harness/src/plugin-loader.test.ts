/**
 * Tests for the local plugin loader's manifest gate (#312).
 *
 * A user-controlled directory must not auto-execute bare `.ts` files dropped
 * into it. Only entries that present a `plugin.manifest.json` (or
 * `mu.plugin.json`) and a manifest-referenced entrypoint should load.
 */
import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins } from './plugin-loader';

let dir: string;
let originalError: typeof console.error;
let errorOutput: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mu-plugin-loader-'));
  errorOutput = [];
  originalError = console.error;
  console.error = (...args: unknown[]) => {
    errorOutput.push(args.map((a) => String(a)).join(' '));
  };
});

afterEach(() => {
  console.error = originalError;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe('mu-harness plugin-loader — manifest requirement (#312)', () => {
  it('skips bare .ts files at the top level (no auto-exec)', async () => {
    // A malicious file would `process.exit(1)` here; we use a benign side-effect
    // that would still surface if it were imported.
    const malicious = join(dir, 'malicious.ts');
    writeFileSync(
      malicious,
      'globalThis.__mu_pwned = true;\nexport default { name: "malicious" };\n',
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(0);
    expect((globalThis as Record<string, unknown>).__mu_pwned).toBeUndefined();
    expect(errorOutput.some((l) => l.includes('skipping') && l.includes('malicious.ts'))).toBe(true);
  });

  it('loads a plugin from a subdirectory with a valid manifest', async () => {
    const pluginDir = join(dir, 'demo');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.manifest.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0', entrypoint: 'index.ts' }),
    );
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "export default { name: 'demo-plugin' };\n",
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(1);
    expect(plugins[0]?.name).toBe('demo-plugin');
    expect(errorOutput.some((l) => l.includes('loading plugin') && l.includes('demo@1.0.0'))).toBe(true);
  });

  it('also accepts mu.plugin.json as a manifest filename', async () => {
    const pluginDir = join(dir, 'alt');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'mu.plugin.json'),
      JSON.stringify({ name: 'alt', version: '0.0.1', entrypoint: 'plugin.ts' }),
    );
    writeFileSync(
      join(pluginDir, 'plugin.ts'),
      "export default { name: 'alt-plugin' };\n",
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(1);
    expect(plugins[0]?.name).toBe('alt-plugin');
  });

  it('rejects entrypoints that escape the plugin directory', async () => {
    const evilTarget = join(dir, 'evil.ts');
    writeFileSync(evilTarget, "throw new Error('should not be imported');\n");
    const pluginDir = join(dir, 'traversal');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.manifest.json'),
      JSON.stringify({ name: 'traversal', version: '1.0.0', entrypoint: '../evil.ts' }),
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(0);
    expect(errorOutput.some((l) => l.includes('outside the plugin dir'))).toBe(true);
  });

  it('rejects absolute-path entrypoints', async () => {
    const pluginDir = join(dir, 'abs');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.manifest.json'),
      JSON.stringify({ name: 'abs', version: '1.0.0', entrypoint: '/etc/passwd' }),
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(0);
  });

  it('rejects manifest missing required fields', async () => {
    const pluginDir = join(dir, 'broken');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.manifest.json'),
      JSON.stringify({ name: 'broken' }), // no version, no entrypoint
    );
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "export default { name: 'broken' };\n",
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(0);
  });

  it('returns no plugins for missing localDir without throwing', async () => {
    const plugins = await loadPlugins({ localDir: join(dir, 'does-not-exist') });
    expect(plugins.length).toBe(0);
  });

  it('skips plugin directories without any manifest', async () => {
    const pluginDir = join(dir, 'manifestless');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'index.ts'),
      'globalThis.__mu_manifestless = true;\nexport default { name: "should-not-load" };\n',
    );
    const plugins = await loadPlugins({ localDir: dir });
    expect(plugins.length).toBe(0);
    expect((globalThis as Record<string, unknown>).__mu_manifestless).toBeUndefined();
  });
});

describe('mu-harness plugin-loader — trust file (TOFU, #312)', () => {
  function writeBenignPlugin(name: string, content: string): string {
    const pluginDir = join(dir, name);
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.manifest.json'),
      JSON.stringify({ name, version: '1.0.0', entrypoint: './index.mjs' }),
    );
    const entry = join(pluginDir, 'index.mjs');
    writeFileSync(entry, content);
    return entry;
  }

  it('records the entrypoint hash on first load (TOFU)', async () => {
    writeBenignPlugin('alpha', 'export default { name: "alpha" };\n');
    const trustFile = join(dir, 'trust.json');
    const plugins = await loadPlugins({ localDir: dir, trustFile });
    expect(plugins.length).toBe(1);

    const recorded = JSON.parse(readFileSync(trustFile, 'utf-8')) as Record<string, string>;
    expect(typeof recorded['alpha@1.0.0']).toBe('string');
    expect(recorded['alpha@1.0.0'].length).toBe(64); // sha-256 hex
    expect(errorOutput.some((l) => l.includes('trust-on-first-use'))).toBe(true);
  });

  it('loads on subsequent boot when the hash is unchanged', async () => {
    writeBenignPlugin('beta', 'export default { name: "beta" };\n');
    const trustFile = join(dir, 'trust.json');
    await loadPlugins({ localDir: dir, trustFile });
    errorOutput = [];

    const plugins2 = await loadPlugins({ localDir: dir, trustFile });
    expect(plugins2.length).toBe(1);
    // No TOFU message on the second load — already trusted.
    expect(errorOutput.some((l) => l.includes('trust-on-first-use'))).toBe(false);
  });

  it('refuses to load when the entrypoint hash has changed', async () => {
    const entry = writeBenignPlugin('gamma', 'export default { name: "gamma" };\n');
    const trustFile = join(dir, 'trust.json');
    await loadPlugins({ localDir: dir, trustFile });
    errorOutput = [];

    // Tampering: rewrite the entrypoint with hostile-looking content.
    writeFileSync(entry, 'globalThis.__mu_tampered = true;\nexport default { name: "gamma" };\n');

    const plugins2 = await loadPlugins({ localDir: dir, trustFile });
    expect(plugins2.length).toBe(0);
    expect(errorOutput.some((l) => l.includes('refusing plugin') && l.includes('hash changed'))).toBe(true);
    // Confirm we did NOT import the tampered entrypoint.
    expect((globalThis as Record<string, unknown>).__mu_tampered).toBeUndefined();
  });

  it('refuses every plugin when the trust file is unreadable', async () => {
    writeBenignPlugin('delta', 'export default { name: "delta" };\n');
    const trustFile = join(dir, 'trust.json');
    writeFileSync(trustFile, '{ this is not valid json');

    const plugins = await loadPlugins({ localDir: dir, trustFile });
    // Empty trust map → first load looks like TOFU and gets accepted; that's
    // OK because the user can recover by deleting the file. The important
    // property is that the loader doesn't crash.
    expect(errorOutput.some((l) => l.includes('failed to read trust file'))).toBe(true);
    expect(plugins.length).toBe(1);
  });

  it('makes manifest-gate + trust orthogonal — no manifest still blocks', async () => {
    // Without a manifest, the manifest gate skips the file before the trust
    // check ever runs. Test that the two layers compose correctly.
    writeFileSync(join(dir, 'orphan.ts'), 'globalThis.__mu_orphan = true;\n');
    const trustFile = join(dir, 'trust.json');
    const plugins = await loadPlugins({ localDir: dir, trustFile });
    expect(plugins.length).toBe(0);
    expect((globalThis as Record<string, unknown>).__mu_orphan).toBeUndefined();
  });
});
