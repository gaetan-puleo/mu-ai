# mu

Minimal terminal AI assistant for local models.

## Monorepo Structure

```
packages/
├── mu-provider/   # LLM provider abstraction (streaming, model listing)
├── mu-agents/     # Agent loop + plugin system (tools, hooks, commands)
├── mu-repomap/    # Code indexing plugin (ast-grep based repomap)
└── mu-coding/     # CLI + TUI application
```

## Features

- **Local-first** — works with any OpenAI-compatible API (Ollama, LM Studio, llama-swap, etc.)
- **Streaming** — real-time token streaming with reasoning content support
- **Plugin system** — extensible via plugins (tools, lifecycle hooks, commands, custom agent loops)
- **Code aware** — automatic project indexing via `ast-grep`, search symbols and browse file trees
- **Session persistence** — conversations auto-saved, resume with `mu -c`
- **Slash commands** — `/model`, `/sessions`, `/new`, `/reasoning`, `/paste`, `/select`
- **Single-shot mode** — quick answers without launching the TUI
- **Minimal deps** — only `ink` + `react` as npm dependencies

## Installation

```bash
git clone https://github.com/you/mu.git
cd mu
bun install
bun start
```

Requires [Bun](https://bun.sh/) runtime.

## Usage

```bash
# Interactive chat
mu

# Single-shot prompt
mu -p "explain bubble sort"

# With specific model
mu -m qwen3-coder -p "what's in this directory"

# Continue most recent session
mu -c

# Resume a specific session
mu --session ~/.mu/sessions/2026-04-17T14-30-00-000Z.jsonl

# Help
mu -h
```

## Packages

### `mu-provider`

LLM provider abstraction for local runners and OpenAI-compatible APIs.

```typescript
import { streamChat, listModels } from 'mu-provider';
```

### `mu-agents`

Agent loop orchestration with a full plugin system.

```typescript
import { runAgent, PluginRegistry, createBuiltinPlugin } from 'mu-agents';
import type { Plugin, PluginTool, LifecycleHooks } from 'mu-agents';
```

**Plugin interface:**

```typescript
const myPlugin: Plugin = {
  name: 'my-plugin',
  tools: [/* PluginTool[] */],
  systemPrompt: 'Additional context...',
  hooks: {
    beforeLlmCall: (messages, config) => messages,
    afterToolExec: (toolCall, result) => result,
  },
  commands: [{ name: 'hello', description: 'Say hi', execute: async () => 'Hello!' }],
  activate: async (ctx) => { /* setup */ },
  deactivate: async () => { /* cleanup */ },
};
```

### `mu-repomap`

Code indexing plugin — provides the `search_code` tool and system prompt context.

```typescript
import { createRepomapPlugin } from 'mu-repomap';

const plugin = createRepomapPlugin({ maxFiles: 100 });
await registry.register(plugin);
```

### `mu-coding`

The CLI + TUI application that composes everything.

## Plugin Configuration

Add plugins to `~/.mu/config.json`:

```json
{
  "baseUrl": "http://localhost:8080/v1",
  "plugins": [
    "mu-repomap",
    { "name": "./path/to/local/plugin", "config": { "key": "value" } }
  ]
}
```

Plugins are auto-discovered from `node_modules` or loaded from local paths.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` / `Ctrl+S` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+C` | Abort streaming / Quit (press twice) |
| `Esc` | Stop generation (press twice) |
| `Ctrl+N` | New conversation |
| `Ctrl+M` | Cycle models |
| `Ctrl+O` | Model picker |
| `Ctrl+R` | Toggle reasoning |
| `↑` / `↓` | Navigate input history |
| `PageUp` / `PageDown` | Scroll chat |

## Configuration

First run auto-creates `~/.mu/config.json`:

```json
{
  "baseUrl": "http://localhost:8080/v1",
  "maxTokens": 4096,
  "temperature": 0.7,
  "streamTimeoutMs": 60000
}
```

Models are auto-discovered from the API at startup. Use `-m` or `MU_MODEL` to override.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MU_BASE_URL` | `http://localhost:8080/v1` | OpenAI-compatible API endpoint |
| `MU_MODEL` | *(auto-detected)* | Model name (fetched from API if not set) |
| `MU_MAX_TOKENS` | `4096` | Max generation tokens |
| `MU_TEMPERATURE` | `0.7` | Sampling temperature |
| `MU_STREAM_TIMEOUT` | `60000` | Stream inactivity timeout (ms) |
| `MU_SYSTEM_PROMPT` | *(none)* | System prompt text |

## Supported Backends

Any OpenAI-compatible API works. Tested with:

- **llama-swap** — `http://localhost:8080/v1`
- **Ollama** — `http://localhost:11434/v1`
- **LM Studio** — `http://localhost:1234/v1`
- **LocalAI** — custom endpoint
- **Mistral.rs** — `http://localhost:8080/v1`

## Development

```bash
# Dev mode (watches for changes)
bun run dev

# Lint
bun run lint

# Type check
bun run check
```

## License

MIT
