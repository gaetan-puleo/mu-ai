import { defineConfig } from 'tsup';

// Two artifacts from one product package:
//  1. The CLI app — bundle the bin entry (local src/* inlined, workspace/npm deps
//     kept external) into a single Node-runnable ESM file with a `node` shebang.
//  2. The SDK — what library consumers (arya) import: the harness surface plus the
//     product defaults, with type declarations. No shebang, types included.
// Dev still runs the TypeScript directly via tsx (see package.json scripts).
export default defineConfig([
  {
    entry: { 'coding-agent': 'bin/coding-agent.ts' },
    format: 'esm',
    dts: false,
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    dts: true,
    clean: false,
  },
]);
