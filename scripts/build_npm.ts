#!/usr/bin/env -S deno run -A
import { build, emptyDir } from 'jsr:@deno/dnt@^0.42.3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');

interface PackageDef {
  name: string;
  dir: string;
  description: string;
  entryPoints: (string | { name: string; path: string })[];
  mappings?: Record<string, { name: string; version: string }>;
  deps?: Record<string, string>;
  devDeps?: Record<string, string>;
  bin?: Record<string, string>;
  skipNpmInstall?: boolean;
}

function readVersion(dir: string): string {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf-8'));
  return pkg.version;
}

const VERSION = readVersion('core');

const PACKAGES: PackageDef[] = [
  {
    name: 'mu-core',
    dir: 'core',
    description: 'Agent loop orchestration core: types, plugin SDK, channels, sessions',
    entryPoints: ['./src/index.ts'],
  },
  {
    name: 'mu-tui',
    dir: 'tui',
    description: 'Terminal UI framework for mu agents',
    entryPoints: [
      { name: '.', path: './src/index.ts' },
      { name: './features', path: './src/features/index.ts' },
      { name: './components', path: './src/components/index.ts' },
      { name: './layout', path: './src/layout/index.ts' },
    ],
  },
  {
    name: 'mu-tools',
    dir: 'tools',
    description: 'Shared filesystem + shell tools (read, write, edit, bash, list_dir) for mu hosts',
    entryPoints: ['./src/index.ts'],
    mappings: {
      'mu-core': { name: 'mu-core', version: `^${VERSION}` },
    },
  },
  {
    name: 'mu-local-provider',
    dir: 'local-provider',
    description: 'Local LLM provider for mu-core (llama-swap, Ollama, LM Studio)',
    entryPoints: ['./src/index.ts'],
    mappings: {
      'mu-core': { name: 'mu-core', version: `^${VERSION}` },
    },
    deps: {
      openai: '^6.38.0',
    },
  },
  {
    name: 'mu-webfetch',
    dir: 'webfetch',
    description: 'Webfetch tool for mu — fetches a URL and returns it as text.',
    entryPoints: ['./src/plugin.ts'],
    mappings: {
      'mu-core': { name: 'mu-core', version: `^${VERSION}` },
    },
    deps: {
      turndown: '^7.2.2',
    },
    devDeps: {
      '@types/turndown': '^5.0.6',
    },
  },
  {
    name: 'coding-agent',
    dir: 'coding-agent',
    description: 'AI coding agent powered by mu',
    entryPoints: ['./src/index.ts'],
    mappings: {
      'mu-core': { name: 'mu-core', version: `^${VERSION}` },
      'mu-local-provider': { name: 'mu-local-provider', version: `^${VERSION}` },
      'mu-tools': { name: 'mu-tools', version: `^${VERSION}` },
      'mu-tui': { name: 'mu-tui', version: `^${VERSION}` },
    },
    bin: {
      'coding-agent': './esm/bin/coding-agent.js',
    },
    skipNpmInstall: true,
  },
];

const filter = Deno.args.filter((a) => !a.startsWith('--'));
const packagesToBuild = filter.length > 0
  ? PACKAGES.filter((p) => filter.includes(p.name) || filter.includes(p.dir))
  : PACKAGES;

for (const pkg of packagesToBuild) {
  const pkgDir = resolve(ROOT, 'packages', pkg.dir);
  const outDir = resolve(pkgDir, 'npm');

  console.log(`\n=== Building ${pkg.name} ===`);
  await emptyDir(outDir);

  const entryPoints = pkg.entryPoints.map((ep) => {
    if (typeof ep === 'string') {
      return resolve(pkgDir, ep);
    }
    return { name: ep.name, path: resolve(pkgDir, ep.path) };
  });

  const packageMappings: Record<string, { name: string; version: string }> = {};
  if (pkg.mappings) {
    for (const [key, value] of Object.entries(pkg.mappings)) {
      const mappingPkg = PACKAGES.find((p) => p.name === key);
      if (mappingPkg) {
        const mappingPkgDir = resolve(ROOT, 'packages', mappingPkg.dir);
        const entryPoint = typeof mappingPkg.entryPoints[0] === 'string'
          ? mappingPkg.entryPoints[0]
          : mappingPkg.entryPoints[0].path;
        packageMappings[resolve(mappingPkgDir, entryPoint)] = value;
      }
    }
  }

  await build({
    entryPoints,
    outDir,
    shims: { deno: false },
    compilerOptions: {
      lib: ['ES2022'],
      target: 'ES2022',
    },
    importMap: resolve(ROOT, 'deno.json'),
    package: {
      name: pkg.name,
      version: VERSION,
      description: pkg.description,
      type: 'module',
      license: 'MIT',
      ...(pkg.deps ? { dependencies: pkg.deps } : {}),
      ...(pkg.devDeps ? { devDependencies: pkg.devDeps } : {}),
      ...(pkg.bin ? { bin: pkg.bin } : {}),
    },
    mappings: packageMappings,
    skipSourceOutput: true,
    skipNpmInstall: pkg.skipNpmInstall ?? false,
    test: false,
    typeCheck: false,
  });

  console.log(`  ✓ ${pkg.name} built → ${outDir}`);
}

console.log('\nBuild complete.');
