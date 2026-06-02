#!/usr/bin/env -S deno run -A
import { build, emptyDir } from 'jsr:@deno/dnt@^0.42.3';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function writeBuildImportMap(): string {
  const base = (JSON.parse(readFileSync(resolve(ROOT, 'deno.json'), 'utf-8')).imports ?? {}) as Record<string, string>;
  const imports: Record<string, string> = { ...base };
  for (const dir of LIBS) imports[readPkg(dir).name] = `npm:${readPkg(dir).name}@^${VERSION}`;
  for (const dir of LIBS) {
    for (const [name, range] of Object.entries(readPkg(dir).dependencies ?? {})) {
      if (!isWorkspace(name) && !imports[name]) imports[name] = `npm:${name}@${externalRange(range)}`;
    }
  }
  const path = resolve(ROOT, '.dnt-import-map.json');
  writeFileSync(path, `${JSON.stringify({ imports }, null, 2)}\n`);
  return path;
}

async function buildLib(dir: string, mapPath: string): Promise<void> {
  const meta = readPkg(dir);
  const pkgDir = resolve(ROOT, 'packages', dir);
  const outDir = resolve(pkgDir, 'npm');

  console.log(`\n=== Building ${meta.name} (library, via dnt) ===`);
  await emptyDir(outDir);

  await build({
    entryPoints: [resolve(pkgDir, meta.main ?? './src/index.ts')],
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

  console.log(`  ✓ ${meta.name} → ${outDir}`);
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

const mapPath = writeBuildImportMap();
try {
  for (const dir of LIBS) {
    if (want(readPkg(dir).name, dir)) await buildLib(dir, mapPath);
  }
  if (want('mu-coding', 'coding-agent')) await buildCodingAgent();
} finally {
  rmSync(mapPath, { force: true });
}

console.log('\nBuild complete.');
