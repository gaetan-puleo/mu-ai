# Publishing

The whole workspace is published to npm under unscoped `mu-*` names:

| Package | What | How it's built |
| --- | --- | --- |
| `mu-core` | the agent loop (content, messages, tools, provider, `createAgent`) | `dnt` (ESM + CJS + `.d.ts`) |
| `mu-tui` | terminal UI primitives | `dnt` |
| `mu-ai-tools` | built-in tools | `dnt` |
| `mu-local-provider` | OpenAI-compatible local provider | `dnt` |
| `mu-harness` | the runtime: sessions, agents, plugins, scheduler, commands, permissions, hooks, channels, skills, TUI chat app | `dnt` |
| `mu-webfetch` | web-fetch plugin | `dnt` |
| `mu-coding` | the `mu` CLI | `deno bundle` → one self-contained `bin/mu.js` (zero npm deps, only `node:` builtins, Node ≥ 22.5 for `node:sqlite`) |

The six libraries depend on each other via **real npm version ranges** in their published
artifacts (e.g. `mu-harness` → `mu-core`, `mu-tui`). `scripts/build_npm.ts` does this with a
build-only import map that maps every `mu-*` specifier to `npm:mu-*@^<version>` so `dnt`
**externalizes** workspace deps instead of inlining them (and `skipNpmInstall` avoids the
chicken-and-egg of deps not yet on the registry at build time).

Every source `package.json` is marked `"private": true` so a stray `npm publish` from a
**source** directory is refused. Only the generated `packages/*/npm/` artifacts are
publishable — and `scripts/publish.ts` additionally refuses to publish anything that still
carries a `workspace:` dependency or a `private` flag.

## How to release

One command publishes everything; pushing the tag only builds the binaries. There is a
single publishing mechanism (local) — no double-publish, no CI npm step.

```bash
npm login                              # once (or have a valid ~/.npmrc token)
deno task publish minor --dry-run      # check: bump + topological publish order
deno task publish minor                # bump all 7 in sync → build → publish in order → tag vX.Y.Z
git push && git push --tags            # push code + tag
```

`deno task publish <patch|minor|major|x.y.z>`:

1. bumps every workspace `package.json` to the same version,
2. builds the npm artifacts (`scripts/build_npm.ts`),
3. `npm publish`es in **topological order** so each dependency is on the registry before
   the package that needs it:
   `core → tui → tools → local-provider → harness → webfetch → coding-agent`,
4. commits the bump and creates the `vX.Y.Z` tag.

> Run it from an interactive terminal: if your npm account has 2FA, npm prompts for the OTP
> per package. A headless run without an automation token fails with `EOTP`.

Pushing `vX.Y.Z` triggers `.github/workflows/release.yml`, which **only** cross-compiles the
standalone binaries and attaches them to the GitHub release. It does not publish to npm.

## Build / compile without publishing

```bash
deno task build:npm             # build all npm artifacts into packages/*/npm
deno task build:npm harness     # one package (by dir or name)
deno task compile               # cross-compile standalone binaries → dist/ (all OSes)
deno task compile macos-arm64   # one target
```

## Incident note — 0.16.1 (do not use)

`mu-core@0.16.1` and `mu-coding@0.16.1` were published from the **source** dirs by mistake:
they carry `workspace:*` deps and raw `.ts` entry points, so `npm i -g mu-coding` fails with
`EUNSUPPORTEDPROTOCOL "workspace:"`. npm versions are immutable, so the fix was to release a
clean, self-contained build. The `private` guards above exist to prevent a repeat.
