#!/usr/bin/env -S deno run -A
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');

// Publish order is a topological sort of the internal dependency graph.
const PACKAGES = [
  { name: 'mu-core', dir: 'core' },
  { name: 'mu-tui', dir: 'tui' },
  { name: 'mu-tools', dir: 'tools' },
  { name: 'mu-local-provider', dir: 'local-provider' },
  { name: 'mu-webfetch', dir: 'webfetch' },
  { name: 'coding-agent', dir: 'coding-agent' },
] as const;

const INTERNAL_NAMES = new Set<string>(PACKAGES.map((pkg) => pkg.name));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, cwd = ROOT) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function readPkg(dir: string) {
  return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8'));
}

function writePkg(dir: string, data: Record<string, unknown>) {
  writeFileSync(resolve(dir, 'package.json'), `${JSON.stringify(data, null, 2)}\n`);
}

function bumpVersion(current: string, bump: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.log(`
Usage: deno run -A scripts/publish.ts <patch|minor|major|x.y.z> [options]

Options:
  --dry-run      Show what would happen without making changes
  --tag <tag>    Publish with a custom dist-tag (default: latest)

Examples:
  deno run -A scripts/publish.ts patch
  deno run -A scripts/publish.ts 1.0.0
  deno run -A scripts/publish.ts minor --dry-run
`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const dryRun = args.includes('--dry-run');
const tagIdx = args.indexOf('--tag');
const tag = tagIdx !== -1 ? args[tagIdx + 1] : 'latest';
const versionArg = args.find((a) => !a.startsWith('--'));

if (!versionArg) usage();

// Resolve the target version
const currentVersion = readPkg(resolve(ROOT, 'packages', PACKAGES[0].dir)).version as string;
const BUMP_TYPES = new Set(['patch', 'minor', 'major']);

const nextVersion = BUMP_TYPES.has(versionArg)
  ? bumpVersion(currentVersion, versionArg as 'patch' | 'minor' | 'major')
  : versionArg;

if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  console.error(`Invalid version: ${nextVersion}`);
  process.exit(1);
}

console.log(`\nVersion: ${currentVersion} → ${nextVersion}`);
if (dryRun) console.log('(dry-run — no changes will be made)\n');

// ---------------------------------------------------------------------------
// 1. Update versions in every package.json
// ---------------------------------------------------------------------------

for (const { name, dir: packageDir } of PACKAGES) {
  const dir = resolve(ROOT, 'packages', packageDir);
  const pkg = readPkg(dir);
  pkg.version = nextVersion;

  // Update internal dependency references
  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[depField] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (INTERNAL_NAMES.has(dep)) {
        deps[dep] = nextVersion;
      }
    }
  }

  if (!dryRun) {
    writePkg(dir, pkg);
    console.log(`  ✓ ${name} → ${nextVersion}`);
  } else {
    console.log(`  (would update) ${name} → ${nextVersion}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Publish packages in dependency order
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Build npm packages via dnt
// ---------------------------------------------------------------------------

console.log('\nBuilding npm packages…');
if (dryRun) {
  console.log('  (would run) deno run -A scripts/build_npm.ts');
} else {
  run('deno run -A --sloppy-imports scripts/build_npm.ts');
}

// ---------------------------------------------------------------------------
// 3. Publish packages in dependency order (from npm/ output dirs)
// ---------------------------------------------------------------------------

console.log('\nPublishing packages…');

for (const { name, dir: packageDir } of PACKAGES) {
  const dir = resolve(ROOT, 'packages', packageDir, 'npm');
  const cmd = `npm publish --access public --tag ${tag}`;
  if (dryRun) {
    console.log(`  (would publish) ${name}@${nextVersion}  [${cmd}]`);
  } else {
    console.log(`\n  Publishing ${name}@${nextVersion}…`);
    run(cmd, dir);
  }
}

// ---------------------------------------------------------------------------
// 4. Git tag
// ---------------------------------------------------------------------------

const gitTag = `v${nextVersion}`;
if (dryRun) {
  console.log(`\n  (would tag) ${gitTag}`);
} else {
  console.log(`\nCreating git tag ${gitTag}…`);
  run('git add -A');
  run(`git commit -m "release: ${gitTag}"`);
  run(`git tag ${gitTag}`);
  console.log('\nDone! Run `git push && git push --tags` to push the release.');
}
