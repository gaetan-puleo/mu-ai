# mu

Minimal terminal AI assistant for local models.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/mu-ai/main/install.sh | sh
```

Auto-detects your OS/arch and installs the standalone `mu` binary (no Deno or
Node required) to `~/.local/bin`. Override with `MU_INSTALL_DIR` or pin a
release with `MU_VERSION`:

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/mu-ai/main/install.sh | MU_VERSION=v0.16.3 sh
```

On Windows, download `mu-windows-x64.exe` from the [releases page](https://github.com/gaetan-puleo/mu-ai/releases/latest).

## Monorepo Structure

```
packages/
├── core/              # Runtime primitives: messages, tools, plugin SDK, event bus, sessions
├── harness/           # Shared bootstrap: plugins, skills, sub-agents, permissions, approvals, scheduler, jsonl sessions
├── tui/               # Terminal UI engine (input parser, capability detector, layout, components)
├── tools/             # Filesystem + shell tools (read, write, edit, bash, list_dir)
├── local-provider/    # llama-swap LLM provider
├── webfetch/          # URL fetching tool (HTML to markdown)
└── coding-agent/      # CLI + TUI application
```

Layering: `core` <- `harness` <- `{local-provider, tools, tui, webfetch}` <- `coding-agent`.

## Features

- **Local-first** -- runs against a llama-swap server
- **Streaming** -- real-time token streaming with reasoning content support
- **Plugin system** -- extensible via plugins (tools, lifecycle hooks, commands)
- **Custom TUI** -- terminal UI engine in `mu-tui` (no React/Ink)
- **Session persistence** -- conversations auto-saved, resume with `-c`
- **Slash commands** -- `/sessions`, `/agents`, `/help`, plus plugin-registered commands
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

- **llama-swap** -- `http://localhost:8080/v1`

Other OpenAI-compatible servers may work but the provider only auto-detects
llama-swap.

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
