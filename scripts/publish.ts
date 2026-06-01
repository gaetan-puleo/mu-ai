#!/usr/bin/env -S deno run -A
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const PACKAGES_DIR = resolve(ROOT, 'packages');

const PUBLISH = [
  { name: 'mu-core', dir: 'core' },
  { name: 'mu-coding', dir: 'coding-agent' },
] as const;

function run(cmd: string, cwd = ROOT) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path: string, data: Record<string, unknown>) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function bumpVersion(current: string, bump: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = current.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function usage(): never {
  console.log(`
Usage: deno run -A scripts/publish.ts <patch|minor|major|x.y.z> [options]

Publishes mu-core (library) and coding-agent (self-contained CLI bundle).
All workspace package.json versions are kept in sync.

Options:
  --dry-run      Show what would happen without making changes
  --tag <tag>    Publish with a custom dist-tag (default: latest)
`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tagIdx = args.indexOf('--tag');
const tag = tagIdx !== -1 ? args[tagIdx + 1] : 'latest';
const versionArg = args.find((a) => !a.startsWith('--'));
if (!versionArg) usage();

const currentVersion = readJson(resolve(PACKAGES_DIR, 'core', 'package.json')).version as string;
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

for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = resolve(PACKAGES_DIR, entry.name, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = readJson(path);
  } catch {
    continue;
  }
  pkg.version = nextVersion;
  if (dryRun) {
    console.log(`  (would set) ${pkg.name} → ${nextVersion}`);
  } else {
    writeJson(path, pkg);
    console.log(`  ✓ ${pkg.name} → ${nextVersion}`);
  }
}

console.log('\nBuilding npm artifacts…');
if (dryRun) {
  console.log('  (would run) deno run -A scripts/build_npm.ts');
} else {
  run('deno run -A --sloppy-imports scripts/build_npm.ts');
}

console.log('\nPublishing…');
for (const { name, dir } of PUBLISH) {
  const npmDir = resolve(PACKAGES_DIR, dir, 'npm');
  const cmd = `npm publish --access public --tag ${tag}`;
  if (dryRun) {
    console.log(`  (would publish) ${name}@${nextVersion}  [${cmd}]  in ${npmDir}`);
  } else {
    console.log(`\n  Publishing ${name}@${nextVersion}…`);
    run(cmd, npmDir);
  }
}

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
