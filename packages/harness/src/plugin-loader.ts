import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'mu-core';

export interface LoadPluginsOptions {
  localDir?: string;
  npmSpecs?: string[];
  /**
   * Path to a JSON trust file mapping `"<name>@<version>"` to the
   * sha-256 of the plugin's entrypoint. Enables TOFU verification:
   *
   *   - First load of a plugin: hash is recorded; load proceeds.
   *   - Subsequent loads: hash must match the recorded value; refuse if not.
   *
   * The trust file must NOT live in the plugins dir itself (an attacker
   * with write access to `pluginsDir` would otherwise forge entries).
   * Pass `paths.pluginsTrustFile` from `createXdgPaths`.
   *
   * Omit to skip trust verification entirely.
   */
  trustFile?: string;
}

const PLUGIN_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs']);
const MANIFEST_NAMES = ['plugin.manifest.json', 'mu.plugin.json'] as const;

// Security note (#312): local plugin files are dynamically `import()`-ed, so any
// top-level code in them runs BEFORE `validatePlugin` can reject the shape.
// To stop drive-by drops of arbitrary `.ts` files in the plugins dir from
// auto-executing on boot, we require a sibling `plugin.manifest.json` (or
// `mu.plugin.json`) per plugin entry. Files without a manifest are skipped.
// Every loaded plugin path is logged so the surface is at least visible.
// Sandboxing (worker isolation / capability tokens / trust prompt) is NOT
// implemented in this PR — a malicious manifest+entry combination still has
// full process privileges. Tracked as follow-up.

function defaultLocalDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'mu', 'plugins')
    : join(homedir(), '.config', 'mu', 'plugins');
}

function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && PLUGIN_EXTENSIONS.has(name.slice(dot));
}

interface PluginManifest {
  name: string;
  version: string;
  entrypoint: string;
}

function readManifest(dir: string): { manifest: PluginManifest; manifestPath: string } | undefined {
  for (const name of MANIFEST_NAMES) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    let raw: string;
    try {
      raw = readFileSync(p, 'utf-8');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Failed to read plugin manifest ${p}: ${message}`);
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Invalid JSON in plugin manifest ${p}: ${message}`);
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object') {
      console.error(`Plugin manifest ${p}: must be a JSON object`);
      return undefined;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.name !== 'string' || obj.name === '') {
      console.error(`Plugin manifest ${p}: "name" must be a non-empty string`);
      return undefined;
    }
    if (typeof obj.version !== 'string' || obj.version === '') {
      console.error(`Plugin manifest ${p}: "version" must be a non-empty string`);
      return undefined;
    }
    if (typeof obj.entrypoint !== 'string' || obj.entrypoint === '') {
      console.error(`Plugin manifest ${p}: "entrypoint" must be a non-empty string`);
      return undefined;
    }
    return {
      manifest: { name: obj.name, version: obj.version, entrypoint: obj.entrypoint },
      manifestPath: p,
    };
  }
  return undefined;
}

// Resolve the manifest's entrypoint to an absolute path under `baseDir`.
// Reject `..` traversal and absolute paths — entrypoints must live inside the
// plugin directory.
function resolveEntrypoint(baseDir: string, entrypoint: string): string | undefined {
  if (isAbsolute(entrypoint)) return undefined;
  const candidate = resolve(baseDir, entrypoint);
  const baseResolved = resolve(baseDir);
  if (candidate !== baseResolved && !candidate.startsWith(baseResolved + '/')) return undefined;
  if (!existsSync(candidate)) return undefined;
  if (!hasExtension(candidate)) return undefined;
  return candidate;
}

function validatePlugin(candidate: unknown, source: string): Plugin {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Plugin from ${source}: default export is not an object`);
  }
  const obj = candidate as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name === '') {
    throw new Error(`Plugin from ${source}: "name" must be a non-empty string`);
  }
  if (obj.tools !== undefined && (typeof obj.tools !== 'object' || obj.tools === null)) {
    throw new Error(`Plugin from ${source}: "tools" must be an object`);
  }
  if (obj.hooks !== undefined && (typeof obj.hooks !== 'object' || obj.hooks === null)) {
    throw new Error(`Plugin from ${source}: "hooks" must be an object`);
  }
  if (obj.provider !== undefined && typeof obj.provider !== 'function') {
    throw new Error(`Plugin from ${source}: "provider" must be a function`);
  }
  return candidate as Plugin;
}

function take(mod: unknown, source: string): Plugin {
  const candidate = (mod as { default?: unknown }).default;
  return validatePlugin(candidate, source);
}

// Allow only safe package identifiers; trailing `@<semver>` is permitted on either form.
const SCOPED_SPEC = /^@[\w-]+\/[\w.-]+(?:@[\w.\-+]+)?$/;
const NPM_PREFIXED_SPEC = /^npm:(?:@[\w-]+\/)?[\w.-]+(?:@[\w.\-+]+)?$/;

function isAllowedSpec(spec: string): boolean {
  return NPM_PREFIXED_SPEC.test(spec) || SCOPED_SPEC.test(spec);
}

interface TrustState {
  /** Loaded `{ "<name>@<version>": "<sha256>" }` map. */
  map: Record<string, string>;
  /** Set to true when we add new entries — triggers a flush. */
  dirty: boolean;
  /** Where to persist on flush. */
  file: string;
}

function loadTrustState(file: string): TrustState {
  const state: TrustState = { map: {}, dirty: false, file };
  if (!existsSync(file)) return state;
  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') state.map[key] = value;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`mu-harness: failed to read trust file ${file}: ${message} — refusing all plugin loads`);
    // Block all loads when the trust file is unreadable rather than silently
    // falling back to TOFU and re-trusting everything.
    state.map = {};
    state.dirty = false;
  }
  return state;
}

function flushTrustState(state: TrustState): void {
  if (!state.dirty) return;
  mkdirSync(dirname(state.file), { recursive: true });
  const tmp = `${state.file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state.map, null, 2)}\n`, 'utf-8');
  renameSync(tmp, state.file);
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Decide whether a plugin is allowed to load given its entrypoint hash.
 *
 *  - No trust state → allow (caller opted out of verification).
 *  - Trust entry present + hash matches → allow.
 *  - Trust entry present + hash differs → REFUSE (entrypoint modified).
 *  - Trust entry absent → TOFU: record the hash, allow this load with a
 *    loud log so the user can spot a surprise.
 */
function checkTrust(
  state: TrustState | undefined,
  key: string,
  hash: string,
): { ok: true } | { ok: false; reason: string } {
  if (!state) return { ok: true };
  const recorded = state.map[key];
  if (recorded === undefined) {
    console.error(`mu-harness: trust-on-first-use: recording ${key} = ${hash}`);
    state.map[key] = hash;
    state.dirty = true;
    return { ok: true };
  }
  if (recorded !== hash) {
    return {
      ok: false,
      reason: `entrypoint hash changed (recorded ${recorded.slice(0, 12)}…, current ${hash.slice(0, 12)}…) — remove the entry from the trust file to re-trust`,
    };
  }
  return { ok: true };
}

async function loadFromManifest(
  pluginDir: string,
  plugins: Plugin[],
  trust: TrustState | undefined,
): Promise<void> {
  const found = readManifest(pluginDir);
  if (!found) return;
  const { manifest, manifestPath } = found;
  const entryPath = resolveEntrypoint(pluginDir, manifest.entrypoint);
  if (!entryPath) {
    console.error(
      `Plugin "${manifest.name}" (${manifestPath}): entrypoint "${manifest.entrypoint}" is missing, outside the plugin dir, or has an unsupported extension`,
    );
    return;
  }
  // Verify (or TOFU-record) before any import so a hash mismatch never runs
  // top-level code.
  const key = `${manifest.name}@${manifest.version}`;
  const hash = hashFile(entryPath);
  const decision = checkTrust(trust, key, hash);
  if (!decision.ok) {
    console.error(`mu-harness: refusing plugin "${key}" at ${entryPath}: ${decision.reason}`);
    return;
  }
  // Loud, mandatory log of the executable path before import. Makes the
  // attack surface visible per #312.
  console.error(`mu-harness: loading plugin "${key}" from ${entryPath}`);
  const url = pathToFileURL(entryPath).href;
  try {
    const mod = await import(url);
    plugins.push(take(mod, entryPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load plugin from ${entryPath}: ${message}`);
  }
}

export async function loadPlugins(opts: LoadPluginsOptions = {}): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  const localDir = opts.localDir ?? defaultLocalDir();
  const trust = opts.trustFile ? loadTrustState(opts.trustFile) : undefined;

  if (existsSync(localDir)) {
    // Per #312: only load plugins that present a manifest file. We accept
    //   <localDir>/<plugin>/plugin.manifest.json              (preferred layout)
    //   <localDir>/plugin.manifest.json                        (single-plugin dir)
    // Bare `.ts/.js` files dropped at the top level are NO LONGER executed.
    // When `trustFile` is set, each entrypoint's sha-256 is also verified
    // (TOFU on first load, exact-match thereafter).
    const topManifest = readManifest(localDir);
    if (topManifest) {
      await loadFromManifest(localDir, plugins, trust);
    }
    const entries = readdirSync(localDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = join(localDir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) {
        // Surface the skipped file so users notice why their old layout stopped working.
        if (entry.isFile() && hasExtension(entry.name)) {
          console.error(
            `mu-harness: skipping ${fullPath} — plugin files must live in a subdirectory with a plugin.manifest.json (see #312)`,
          );
        }
        continue;
      }
      await loadFromManifest(fullPath, plugins, trust);
    }
  }

  for (const spec of opts.npmSpecs ?? []) {
    if (!isAllowedSpec(spec)) {
      throw new Error(`Invalid plugin spec "${spec}": must start with "npm:" or "@"`);
    }
    console.error(`mu-harness: loading npm plugin "${spec}"`);
    try {
      const mod = await import(spec);
      plugins.push(take(mod, spec));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load plugin "${spec}": ${message}`);
    }
  }

  if (trust) flushTrustState(trust);

  return plugins;
}
