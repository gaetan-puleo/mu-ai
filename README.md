# mu

Minimal terminal AI assistant for local models.

## Monorepo Structure

```
packages/
├── core/              # Plugin SDK, runtime, event bus, sessions, hooks, types
├── tui/               # Zero-dependency terminal UI engine (differential rendering, input parsing)
├── tools/             # Filesystem + shell tools (read, write, edit, bash, list_dir)
├── local-provider/    # Local LLM provider (OpenAI-compatible: Ollama, LM Studio, llama-swap)
├── webfetch/          # URL fetching tool (HTML to markdown)
└── coding-agent/      # CLI + TUI application
```

Layering: `core` <- `{local-provider, tools, tui, webfetch}` <- `coding-agent`.

## Features

- **Local-first** -- works with any OpenAI-compatible API (Ollama, LM Studio, llama-swap, etc.)
- **Streaming** -- real-time token streaming with reasoning content support
- **Plugin system** -- extensible via plugins (tools, lifecycle hooks, commands)
- **Zero-dep TUI** -- custom terminal UI with synchronized rendering, no React/Ink
- **Session persistence** -- conversations auto-saved, resume with `mu -c`
- **Slash commands** -- `/model`, `/sessions`, `/new`, plus plugin-registered commands
- **Single-shot mode** -- quick answers without launching the TUI

## Requirements

- [Deno](https://deno.com/) (runtime)
- `npm` (for installing third-party dependencies into `node_modules/`)

## Getting Started

```bash
git clone <repo-url>
cd mu
npm install
deno task dev
```

## Usage

```bash
# Interactive chat
deno task start

# Dev mode
deno task dev

# With TUI debug logging
deno task dev:tui-debug
```

## Development

```bash
deno task dev          # Run in dev mode
deno task test         # Run tests
deno task lint         # Lint
deno task fmt          # Format
deno task fmt:check    # Check formatting
deno task check        # Type check
deno task compile      # Compile to standalone binary
```

## Configuration

Config lives at `~/.config/mu/config.json`:

```json
{
  "baseUrl": "http://localhost:8080/v1",
  "maxTokens": 4096,
  "temperature": 0.7,
  "streamTimeoutMs": 60000
}
```

### XDG Directories

| Path                          | Purpose             |
| ----------------------------- | ------------------- |
| `~/.config/mu/config.json`    | Configuration       |
| `~/.config/mu/SYSTEM.md`      | System prompt       |
| `~/.local/share/mu/sessions/` | Saved conversations |

### Environment Variables

| Variable            | Default                    | Description                    |
| ------------------- | -------------------------- | ------------------------------ |
| `MU_BASE_URL`       | `http://localhost:8080/v1` | OpenAI-compatible API endpoint |
| `MU_MODEL`          | _(auto-detected)_          | Model name                     |
| `MU_MAX_TOKENS`     | `4096`                     | Max generation tokens          |
| `MU_TEMPERATURE`    | `0.7`                      | Sampling temperature           |
| `MU_STREAM_TIMEOUT` | `60000`                    | Stream inactivity timeout (ms) |
| `MU_SYSTEM_PROMPT`  | _(none)_                   | System prompt text             |

## Supported Backends

Any OpenAI-compatible API works. Tested with:

- **llama-swap** -- `http://localhost:8080/v1`
- **Ollama** -- `http://localhost:11434/v1`
- **LM Studio** -- `http://localhost:1234/v1`

## Keyboard Shortcuts

| Key                | Action                               |
| ------------------ | ------------------------------------ |
| `Enter` / `Ctrl+S` | Send message                         |
| `Shift+Enter`      | New line                             |
| `Ctrl+C`           | Abort streaming / Quit (press twice) |
| `Esc`              | Stop generation / Dismiss toast      |
| `Ctrl+N`           | New conversation                     |
| `Ctrl+M`           | Cycle models                         |
| `Ctrl+O`           | Model picker                         |

## npm Publishing

```bash
deno task build:npm          # Build npm packages via dnt
deno task publish patch      # Bump + publish all packages
```

## License

MIT
