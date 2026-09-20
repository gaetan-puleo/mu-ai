# AGENTS.md

## Commit convention (required)

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit. The release pipeline (`semantic-release`) derives version bumps directly from commit messages on `main`:

| Commit type | Effect |
|---|---|
| `feat:` | minor bump |
| `fix:` | patch bump |
| `feat!:` or `BREAKING CHANGE:` | major bump |
| `chore:` / `ci:` / `docs:` / `refactor:` / `test:` / `style:` | no release |

Format: `<type>(<optional scope>): <summary>` — e.g. `feat(coding-agent): add streaming tool output`.

Rules:
- Only use `feat:` / `fix:` for changes that should ship to npm.
- Use `chore:` / `ci:` / `refactor:` / `docs:` for internal, tooling, or non-functional changes so they do NOT trigger a release.
- All mu packages (`mu-core`, `mu-tui`, `mu-local-provider`, `mu-ai-tools`, `mu-coding`, `mu-webfetch`) are bumped together to the same version.
- Never bump versions by hand — push a conventional commit and let CI release.
