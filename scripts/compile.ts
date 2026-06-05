#!/usr/bin/env -S deno run -A
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const ENTRY = resolve(ROOT, 'packages/coding-agent/bin/coding-agent.ts');
const DIST = resolve(ROOT, 'dist');
const BUNDLE = resolve(DIST, 'mu.bundle.js');

const TARGETS = [
  { target: 'x86_64-unknown-linux-gnu', out: 'mu-linux-x64' },
  { target: 'aarch64-unknown-linux-gnu', out: 'mu-linux-arm64' },
  { target: 'x86_64-apple-darwin', out: 'mu-macos-x64' },
  { target: 'aarch64-apple-darwin', out: 'mu-macos-arm64' },
  { target: 'x86_64-pc-windows-msvc', out: 'mu-windows-x64.exe' },
];

async function sh(cmd: string, args: string[]): Promise<void> {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const { code } = await new Deno.Command(cmd, { args, stdout: 'inherit', stderr: 'inherit' }).output();
  if (code !== 0) throw new Error(`${cmd} failed (exit ${code})`);
}

const only = Deno.args.filter((a) => !a.startsWith('--'));
const selected = only.length > 0
  ? TARGETS.filter((t) => only.some((o) => t.target.includes(o) || t.out.includes(o)))
  : TARGETS;

mkdirSync(DIST, { recursive: true });

console.log('Bundling the CLI into a single self-contained module…');
await sh('deno', ['bundle', '--platform', 'deno', '--output', BUNDLE, ENTRY]);

try {
  for (const { target, out } of selected) {
    console.log(`\n=== ${out}  (${target}) ===`);
    await sh('deno', ['compile', '-A', '--no-config', '--no-check', '--target', target, '--output', resolve(DIST, out), BUNDLE]);
  }
} finally {
  rmSync(BUNDLE, { force: true });
}

console.log(`\nDone — binaries in ${DIST}`);
