/**
 * Plugin install/uninstall helpers.
 *
 * - `installNpmPlugin(spec)` pre-fetches an npm spec so subsequent dynamic
 *   imports resolve offline. Uses `deno cache` when running under Deno, or
 *   `npm install` under Node (best-effort; the host's CLI should wrap this).
 * - `installLocalFile(srcPath, pluginsDir)` copies a `.ts` file into the
 *   plugin directory so the loader picks it up on next start.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

export const PLUGIN_TRUST_WARNING =
  'Plugins run with full system access. Only install from sources you trust.';

declare const Deno:
  | { Command: new (cmd: string, opts: { args: string[]; stdout?: string; stderr?: string }) => { output: () => Promise<{ code: number }> } }
  | undefined;

async function runCommand(cmd: string, args: string[]): Promise<void> {
  if (typeof Deno !== 'undefined' && Deno?.Command) {
    const c = new Deno.Command(cmd, { args, stdout: 'inherit', stderr: 'inherit' });
    const { code } = await c.output();
    if (code !== 0) {
      throw new Error(`${cmd} ${args.join(' ')} exited with code ${code}`);
    }
    return;
  }
  // Node fallback via child_process
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
}

/**
 * Pre-fetch an npm spec so subsequent dynamic imports resolve without network.
 * Caller decides what to do with the spec afterwards (e.g. record it in config).
 */
export async function installNpmPlugin(spec: string): Promise<void> {
  if (!spec.startsWith('npm:') && !spec.startsWith('@')) {
    throw new Error(`Invalid plugin spec "${spec}": must start with "npm:" or "@"`);
  }
  process.stderr.write(`[mu-harness/plugins] ${PLUGIN_TRUST_WARNING}\n`);
  if (typeof Deno !== 'undefined' && Deno?.Command) {
    await runCommand('deno', ['cache', spec]);
  } else {
    await runCommand('npm', ['install', spec]);
  }
}

/**
 * Copy a local `.ts` plugin file into `pluginsDir`. The harness loader picks
 * up every `.ts/.mts/.js/.mjs` from that directory on startup.
 */
export function installLocalPluginFile(srcPath: string, pluginsDir: string): string {
  process.stderr.write(`[mu-harness/plugins] ${PLUGIN_TRUST_WARNING}\n`);
  const abs = isAbsolute(srcPath) ? srcPath : resolve(process.cwd(), srcPath);
  if (!existsSync(abs)) {
    throw new Error(`file not found: ${abs}`);
  }
  if (!abs.endsWith('.ts') && !abs.endsWith('.mts') && !abs.endsWith('.js') && !abs.endsWith('.mjs')) {
    throw new Error(`local plugin must be a .ts/.mts/.js/.mjs file: ${abs}`);
  }
  mkdirSync(pluginsDir, { recursive: true });
  const dest = join(pluginsDir, basename(abs));
  copyFileSync(abs, dest);
  return dest;
}
