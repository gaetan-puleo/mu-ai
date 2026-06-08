#!/usr/bin/env -S deno run -A
import { build, emptyDir } from 'jsr:@deno/dnt@^0.42.3';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');

interface Pkg {
  name: string;
  version: string;
  description: string;
  main?: string;
  dependencies?: Record<string, string>;
}

function readPkg(dir: string): Pkg {
  return JSON.parse(readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf-8'));
}

const VERSION = readPkg('core').version;

const LIBS = ['core', 'tui', 'tools', 'local-provider', 'harness', 'webfetch'] as const;
const isWorkspace = (dep: string): boolean => dep.startsWith('mu-');

function externalRange(range: string): string {
  return range.startsWith('workspace:') ? `^${VERSION}` : range;
}

function depsFor(meta: Pkg): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(meta.dependencies ?? {})) {
    out[name] = isWorkspace(name) ? `^${VERSION}` : range;
  }
  return out;
}

/**
 * Per-lib import map: every SIBLING `mu-*` maps to `npm:mu-*@^VERSION` so dnt
 * externalizes it as a real dependency. The lib's OWN `mu-self` specifier is left
 * UNMAPPED so an internal self-import resolves through the workspace symlink to the
 * package's own (entry) source — mapping self to a local path re-inlines the tree.
 * Combined with a NAMED entry point (`{ name: '.', … }`), dnt keeps siblings external
 * instead of inlining their source — the key to a clean per-package monorepo build.
 */
function writeImportMap(currentDir: string): string {
  const base = (JSON.parse(readFileSync(resolve(ROOT, 'deno.json'), 'utf-8')).imports ?? {}) as Record<string, string>;
  const imports: Record<string, string> = { ...base };
  for (const dir of LIBS) {
    if (dir === currentDir) continue;
    imports[readPkg(dir).name] = `npm:${readPkg(dir).name}@^${VERSION}`;
  }
  for (const dir of LIBS) {
    for (const [name, range] of Object.entries(readPkg(dir).dependencies ?? {})) {
      if (!isWorkspace(name) && !imports[name]) imports[name] = `npm:${name}@${externalRange(range)}`;
    }
  }
  // Write OUTSIDE the repo: an import map adjacent to the workspace deno.json gets
  // overridden by the workspace's own resolution (which inlines siblings).
  const path = join(tmpdir(), 'mu-dnt-import-map.json');
  writeFileSync(path, `${JSON.stringify({ imports }, null, 2)}\n`);
  return path;
}

/** dnt emits the declarations but does not wire them into package.json. dnt names the
 * '.' entry after its source basename (index.ts → index.js, plugin.ts → plugin.js);
 * point the entry/types there. `entry` is that basename without extension. */
function wireTypes(outDir: string, entry: string): void {
  const path = resolve(outDir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  pkg.main = `./script/${entry}.js`;
  pkg.module = `./esm/${entry}.js`;
  pkg.types = `./esm/${entry}.d.ts`;
  pkg.exports = {
    '.': {
      import: { types: `./esm/${entry}.d.ts`, default: `./esm/${entry}.js` },
      require: { types: `./script/${entry}.d.ts`, default: `./script/${entry}.js` },
    },
  };
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function buildLib(dir: string): Promise<void> {
  const meta = readPkg(dir);
  const pkgDir = resolve(ROOT, 'packages', dir);
  const finalDir = resolve(pkgDir, 'npm');
  // Build OUTSIDE the workspace, then copy in. An outDir inside the workspace makes dnt
  // discover the workspace deno.json and inline siblings instead of externalizing them.
  const outDir = join(tmpdir(), `mu-npm-${meta.name}`);

  console.log(`\n=== Building ${meta.name} (library, via dnt) ===`);
  await emptyDir(outDir);

  const mapPath = writeImportMap(dir);
  try {
    await build({
      // A NAMED entry ('.') is what makes dnt externalize siblings instead of inlining them.
      entryPoints: [{ name: '.', path: resolve(pkgDir, meta.main ?? './src/index.ts') }],
      outDir,
      shims: { deno: false },
      compilerOptions: { lib: ['ES2022'], target: 'ES2022' },
      importMap: mapPath,
      package: {
        name: meta.name,
        version: VERSION,
        description: meta.description,
        type: 'module',
        license: 'MIT',
        dependencies: depsFor(meta),
      },
      skipSourceOutput: true,
      skipNpmInstall: true,
      test: false,
      typeCheck: false,
    });
    wireTypes(outDir, basename(meta.main ?? 'index.ts').replace(/\.[cm]?tsx?$/, ''));
    await emptyDir(finalDir);
    cpSync(outDir, finalDir, { recursive: true });
  } finally {
    rmSync(mapPath, { force: true });
    rmSync(outDir, { recursive: true, force: true });
  }

  console.log(`  ✓ ${meta.name} → ${finalDir}`);
}

async function buildCodingAgent(): Promise<void> {
  const meta = readPkg('coding-agent');
  const pkgDir = resolve(ROOT, 'packages', 'coding-agent');
  const outDir = resolve(pkgDir, 'npm');
  const binOut = resolve(outDir, 'bin/mu.js');

  console.log(`\n=== Building ${meta.name} (self-contained CLI, via deno bundle) ===`);
  await emptyDir(outDir);
  mkdirSync(resolve(outDir, 'bin'), { recursive: true });

  const bundle = new Deno.Command('deno', {
    args: ['bundle', '--platform', 'deno', '--output', binOut, resolve(pkgDir, 'bin/coding-agent.ts')],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await bundle.output();
  if (code !== 0) throw new Error(`deno bundle failed (exit ${code})`);

  const js = readFileSync(binOut, 'utf-8').replace(/^#![^\n]*\n/, '');
  writeFileSync(binOut, `#!/usr/bin/env node\n${js}`);

  writeFileSync(
    resolve(outDir, 'package.json'),
    `${
      JSON.stringify(
        {
          name: meta.name,
          version: VERSION,
          description: meta.description,
          type: 'module',
          license: 'MIT',
          bin: { mu: 'bin/mu.js' },
          engines: { node: '>=22.5.0' },
          files: ['bin'],
        },
        null,
        2,
      )
    }\n`,
  );

  console.log(`  ✓ ${meta.name} → ${outDir}`);
}

const filter = Deno.args.filter((a) => !a.startsWith('--'));
const want = (name: string, dir: string) => filter.length === 0 || filter.includes(name) || filter.includes(dir);

for (const dir of LIBS) {
  if (want(readPkg(dir).name, dir)) await buildLib(dir);
}
if (want('mu-coding', 'coding-agent')) await buildCodingAgent();

console.log('\nBuild complete.');
