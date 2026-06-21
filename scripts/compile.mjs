#!/usr/bin/env node
// Cross-compile the `mu` CLI into standalone binaries with @yao-pkg/pkg.
// Bundles the CLI into one self-contained CJS file (tsup), then produces a native
// executable per target. node:sqlite needs Node >= 24 (stable), so we target node24.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODING = resolve(ROOT, 'packages/coding-agent');
const BUNDLE = resolve(CODING, 'bundle/mu.cjs');
const DIST = resolve(ROOT, 'dist');

const TARGETS = [
  { target: 'node24-linux-x64', out: 'mu-linux-x64' },
  { target: 'node24-linux-arm64', out: 'mu-linux-arm64' },
  { target: 'node24-macos-x64', out: 'mu-macos-x64' },
  { target: 'node24-macos-arm64', out: 'mu-macos-arm64' },
  { target: 'node24-win-x64', out: 'mu-windows-x64.exe' },
];

const only = process.argv.slice(2);
const selected = only.length > 0 ? TARGETS.filter((t) => only.some((o) => t.target.includes(o) || t.out.includes(o))) : TARGETS;

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

console.log('Bundling the mu CLI into one self-contained CJS file…');
run('pnpm', ['exec', 'tsup', '--config', 'tsup.bin.config.ts'], CODING);

for (const { target, out } of selected) {
  console.log(`\n=== ${out}  (${target}) ===`);
  // --public-packages '*' + no bytecode: pkg can't make V8 bytecode for a foreign
  // arch, so embed plain source instead (fine for an open-source CLI; avoids the
  // cross-arch "Failed to generate V8 bytecode" warning and broken binaries).
  run('pnpm', ['exec', 'pkg', BUNDLE, '--targets', target, '--no-bytecode', '--public', '--output', resolve(DIST, out)], ROOT);
}

console.log(`\nDone — binaries in ${DIST}`);
