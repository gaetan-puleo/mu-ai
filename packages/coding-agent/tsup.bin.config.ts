import { defineConfig } from 'tsup';

// Standalone-binary build: bundle EVERYTHING (workspace + npm deps) into one
// self-contained CommonJS file that @yao-pkg/pkg can turn into a native binary.
// node: builtins stay external (provided by the embedded Node). `node:sqlite` is
// loaded via createRequire in the source (see harness session/catalog.ts).
export default defineConfig({
  entry: { mu: 'bin/coding-agent.ts' },
  format: 'cjs',
  dts: false,
  clean: true,
  outDir: 'bundle',
  noExternal: [/.*/],
  shims: true,
  platform: 'node',
  target: 'node22',
});
