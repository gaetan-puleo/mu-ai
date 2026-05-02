# mu-repomap

Code indexing and **layered symbol discovery** plugin for `mu-core`. Builds a
repository map using AST parsing, watches for file changes, and exposes a
`list_symbols` tool for LLM agents.

## Install

```bash
npm install mu-repomap
```

## Usage as Plugin

```ts
import { PluginRegistry } from "mu-core";
import { createRepomapPlugin } from "mu-repomap";

const registry = new PluginRegistry({ cwd: process.cwd(), config: {} });
await registry.register(createRepomapPlugin({ pageSize: 20 }));
```

Once registered, the plugin:

- Indexes the repository on activation
- Watches for file changes and rebuilds incrementally
- Advertises the `list_symbols` tool in the system prompt (no file list preloaded)
- Provides a paginated, layered `list_symbols` tool the LLM can call
- Shows indexing status in the status bar

## `list_symbols` Tool

A **layered** discovery tool — the LLM is instructed to descend progressively
to avoid context overflow. Each layer returns at most `pageSize` entries
(default 20) and ends with a `Next:` hint pointing to the deeper layer.

| Layer | Query | Returns |
|---|---|---|
| **L0 — roots** | `(empty)` | Top-level directories with file/export counts |
| **L1 — directory** | `dir:<path>` | Files + immediate subdirs under `<path>` |
| **L2 — file** | `file:<path>` | All exports in the file (no refs) |
| **L3 — symbol** | `sym:<name>` or `sym:<name>@<file>` | Definition + paginated refs |

### Pagination

Every layer is paginated. When a result is truncated:

```
Page 1/3 — 20 of 47 shown
Next: list_symbols("dir:packages/mu-core/src", page:2)
```

Override the page size with the `pageSize` parameter (only when you've
confirmed the layer is small):

```ts
list_symbols({ query: 'file:src/big.ts', pageSize: 100 })
```

### Example flow

```
list_symbols()
→ 5 root dirs (alpha-sorted, page 1/1)

list_symbols("dir:packages/mu-core/src")
→ subdirs + files of mu-core/src

list_symbols("file:packages/mu-core/src/session.ts")
→ all exports of session.ts (line-sorted)

list_symbols("sym:Session")
→ Session class definition + first 20 refs

list_symbols("sym:Session", page: 2)
→ next 20 refs

list_symbols("sym:Session@packages/mu-core/src/session.ts")
→ disambiguate when multiple files define the same name
```

## Standalone Usage

```ts
import { buildRepomap, listSymbols, RepomapManager } from "mu-repomap";

// Build a repomap directly
const map = await buildRepomap("/path/to/project");

// Layered discovery
console.log(listSymbols(map, { query: '' }));
console.log(listSymbols(map, { query: 'dir:src' }));
console.log(listSymbols(map, { query: 'sym:MyClass', page: 2 }));

// Or use the singleton manager (cached + watcher-friendly)
const manager = RepomapManager.getInstance(process.cwd());
await manager.listSymbols({ query: 'file:src/index.ts' });
```

## Options

```ts
interface RepomapOptions {
  /** Default page size for `list_symbols`. Per-call `pageSize` arg overrides. */
  pageSize?: number; // default 20
}
```

## Slash Commands

| Command | Effect |
|---|---|
| `/repomap` | Show index stats |
| `/repomap:rebuild` | Force a full rebuild |

## Requirements

- [`@ast-grep/cli`](https://ast-grep.github.io/) for AST parsing

## License

MIT
