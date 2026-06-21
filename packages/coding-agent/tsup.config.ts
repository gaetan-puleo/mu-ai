import { defineConfig } from 'tsup';

// The CLI app: bundle the bin entry (local src/* inlined, workspace/npm deps kept
// external) into a single Node-runnable ESM file with a plain `node` shebang.
// Dev still runs the TypeScript directly via tsx (see package.json scripts).
export default defineConfig({
  entry: { 'coding-agent': 'bin/coding-agent.ts' },
  format: 'esm',
  dts: false,
  clean: true,
  // Bundle this package's own src/* into one file; keep all dependencies
  // (the published `mu-*` packages + npm deps) external — installed via npm.
  banner: { js: '#!/usr/bin/env node' },
});
