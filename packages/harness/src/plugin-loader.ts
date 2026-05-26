import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'mu-core';

export interface LoadPluginsOptions {
  localDir?: string;
  npmSpecs?: string[];
}

const PLUGIN_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs']);

function defaultLocalDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'mu', 'plugins')
    : join(homedir(), '.config', 'mu', 'plugins');
}

function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && PLUGIN_EXTENSIONS.has(name.slice(dot));
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

export async function loadPlugins(opts: LoadPluginsOptions = {}): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  const localDir = opts.localDir ?? defaultLocalDir();

  if (existsSync(localDir)) {
    const entries = readdirSync(localDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isFile() || !hasExtension(entry.name)) continue;
      const path = join(localDir, entry.name);
      const url = pathToFileURL(path).href;
      try {
        const mod = await import(url);
        plugins.push(take(mod, path));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to load plugin from ${path}: ${message}`);
      }
    }
  }

  for (const spec of opts.npmSpecs ?? []) {
    if (!isAllowedSpec(spec)) {
      throw new Error(`Invalid plugin spec "${spec}": must start with "npm:" or "@"`);
    }
    try {
      const mod = await import(spec);
      plugins.push(take(mod, spec));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load plugin "${spec}": ${message}`);
    }
  }

  return plugins;
}
