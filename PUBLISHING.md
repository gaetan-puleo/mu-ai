# Publishing

The whole pnpm workspace is published to npm under unscoped `mu-*` names:

| Package | What |
| --- | --- |
| `mu-core` | the agent loop (content, messages, tools, provider, `createAgent`) |
| `mu-tui` | terminal UI primitives |
| `mu-ai-tools` | built-in tools |
| `mu-local-provider` | OpenAI-compatible local provider |
| `mu-harness` | the runtime: sessions, agents, plugins, scheduler, commands, permissions, hooks, channels, skills, TUI chat app |
| `mu-webfetch` | web-fetch plugin |
| `mu-coding` | the `mu` CLI |

Each package is built with **tsup** (ESM `dist/` + `.d.ts`). During local dev the
`main`/`exports` point at the TypeScript `src/` (resolved by tsx/vitest); on publish,
`publishConfig` swaps them to the built `dist/` and `files` ships only `dist`. The libraries
depend on each other via `workspace:*`, which pnpm rewrites to the exact published version on
`pnpm publish`.

## How to release

```bash
# 1. Bump every package to the same version (they move in lockstep):
pnpm -r exec npm version <patch|minor|major> --no-git-tag-version
#    (or edit the "version" fields by hand)

# 2. Build, test, then tag and push — CI publishes on the tag.
pnpm -r build && pnpm test
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which installs, builds, tests,
and runs `pnpm -r publish --access public` using the `NPM_TOKEN` repo secret. pnpm publishes
in dependency order automatically and converts `workspace:*` to real version ranges.

To publish from your machine instead of CI:

```bash
npm login                                  # or a valid ~/.npmrc token
pnpm -r build
pnpm -r publish --access public --no-git-checks
```

> npm package versions are immutable — never reuse a version. Bump before publishing.

## Standalone binaries

The `mu` CLI also ships as a self-contained native binary (no Node required), built
with [@yao-pkg/pkg](https://github.com/yao-pkg/pkg):

```bash
pnpm compile                # all targets → dist/mu-{linux,macos}-{x64,arm64}, mu-windows-x64.exe
pnpm compile linux-x64      # one target
```

`scripts/compile.mjs` bundles the CLI into one self-contained CJS file (`tsup --config
tsup.bin.config.ts`, everything inlined) then runs `pkg` per target. Binaries embed **Node 24**
(needed for the stable `node:sqlite`). On a `vX.Y.Z` tag the `binaries` job in
`.github/workflows/release.yml` runs `pnpm compile` and attaches `dist/mu-*` to the GitHub
release that `install.sh` downloads from.

