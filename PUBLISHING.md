# Publishing

Two packages are published to npm:

- **`mu-core`** — the library, built with `dnt` (ESM + CJS + `.d.ts`).
- **`mu-coding`** — the CLI (`mu` command), bundled with `deno bundle` into a single
  self-contained `bin/mu.js` (zero npm deps, only `node:` builtins, requires Node ≥ 22.5
  for `node:sqlite`).

Every workspace `package.json` is marked `"private": true` so a stray `npm publish`
from a **source** directory is refused by npm. Only the generated `packages/*/npm/`
artifacts are publishable — and `scripts/publish.ts` additionally refuses to publish
anything that still carries a `workspace:` dependency.

## Release — option A: CI on tag (recommended, no OTP)

`.github/workflows/release.yml` publishes both packages and attaches the cross-OS
binaries whenever a `v*` tag is pushed. One-time setup: create an npm **automation**
token (`npm token create --read-only=false`, or via npmjs.com) — automation tokens
bypass 2FA — and add it as the repo secret `NPM_TOKEN`. Then:

```bash
deno task publish <version> --dry-run   # optional: bump versions + sanity-check
# commit the version bump, then:
git tag vX.Y.Z && git push --tags        # CI builds, publishes, and releases binaries
```

## Release — option B: locally (needs interactive OTP)

```bash
deno task publish patch         # or minor | major | x.y.z
# npm prompts for your 2FA OTP (account is auth-and-writes) — enter it when asked
git push && git push --tags
```

This bumps all workspace versions in sync, builds both artifacts, publishes
`mu-core` + `mu-coding` from their `npm/` dirs, then commits + tags `vX.Y.Z`.

> Run it from an interactive terminal so npm can prompt for the OTP. A headless run
> (e.g. an agent/CI without an automation token) fails with `EOTP` — that is exactly
> why option A exists.

## Build / compile without publishing

```bash
deno task build:npm             # build the npm artifacts into packages/*/npm
deno task compile               # cross-compile standalone binaries → dist/ (all OSes)
deno task compile macos-arm64   # one target
```

## Incident note — 0.16.1 (do not use)

`mu-core@0.16.1` and `mu-coding@0.16.1` were published from the **source** dirs by
mistake: they carry `workspace:*` deps and raw `.ts` entry points, so
`npm i -g mu-coding` fails with `EUNSUPPORTEDPROTOCOL "workspace:"`. npm versions are
immutable, so the fix is to release **0.16.2** (clean, self-contained) as `latest`.
The `private` guards above exist to prevent a repeat.
