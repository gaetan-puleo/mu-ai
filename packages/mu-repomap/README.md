# mu-repomap

Code indexing and symbol search plugin for `mu-core`. Builds a repository map using AST parsing, watches for file changes, and exposes a `search_code` tool for LLM agents.

## Install

```bash
npm install mu-repomap
```

## Usage as Plugin

```ts
import { PluginRegistry } from "mu-core";
import { createRepomapPlugin } from "mu-repomap";

const registry = new PluginRegistry({ cwd: process.cwd(), config: {} });
await registry.register(createRepomapPlugin({ maxFiles: 80, maxRefs: 10 }));
```

Once registered, the plugin:

- Indexes the repository on activation
- Watches for file changes and rebuilds incrementally
- Injects a code summary into the system prompt
- Provides a `search_code` tool the LLM can call
- Shows indexing status in the status bar

## `search_code` Tool

The LLM can query the index:

| Query | Result |
|-------|--------|
| `"useState"` | Find symbol by name |
| `"fn"` or `"class"` | Find by symbol kind |
| `"all"` or `"summary"` | Full project summary |
| `"src/utils/p-limit.ts"` | View a specific file's symbols |
| `"tree"` | Project tree view |
| `"stats"` | Index statistics |

## Standalone Usage

```ts
import { buildRepomap, findSymbol, RepomapManager } from "mu-repomap";

// Build a repomap directly
const map = await buildRepomap("/path/to/project");

// Or use the singleton manager
const manager = RepomapManager.getInstance(process.cwd());
const symbols = await manager.findSymbol("MyComponent");
```

## Options

```ts
interface RepomapOptions {
  maxFiles?: number; // max files in summary (default: 80)
  maxRefs?: number;  // max references per symbol (default: 10)
}
```

## Requirements

- [`@ast-grep/cli`](https://ast-grep.github.io/) for AST parsing

## License

MIT
