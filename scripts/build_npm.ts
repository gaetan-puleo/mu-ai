#!/usr/bin/env -S deno run -A
import { build, emptyDir } from 'jsr:@deno/dnt@^0.42.3';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');

function readPkg(dir: string): { name: string; version: string; description: string } {
  return JSON.parse(readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf-8'));
}

const VERSION = readPkg('core').version;

async function buildCore(): Promise<void> {
  const meta = readPkg('core');
  const pkgDir = resolve(ROOT, 'packages', 'core');
  const outDir = resolve(pkgDir, 'npm');

  console.log(`\n=== Building ${meta.name} (library, via dnt) ===`);
  await emptyDir(outDir);

  await build({
    entryPoints: [resolve(pkgDir, './src/index.ts')],
    outDir,
    shims: { deno: false },
    compilerOptions: { lib: ['ES2022'], target: 'ES2022' },
    importMap: resolve(ROOT, 'deno.json'),
    package: {
      name: meta.name,
      version: VERSION,
      description: meta.description,
      type: 'module',
      license: 'MIT',
    },
    skipSourceOutput: true,
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

if (want('mu-core', 'core')) await buildCore();
if (want('mu-coding', 'coding-agent')) await buildCodingAgent();

console.log('\nBuild complete.');
