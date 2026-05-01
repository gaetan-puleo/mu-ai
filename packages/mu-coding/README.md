# mu-coding

Minimal terminal AI assistant for local models. A TUI chat interface with tool-calling support, built with Ink and React.

## Install

```bash
npm install -g mu-coding
```

## Usage

```bash
mu                    # Start interactive chat
mu -p "prompt"        # Single-shot prompt, then exit
mu -m model -p "p"    # Single-shot with specific model
mu -m model           # Interactive with specific model
mu -c                 # Continue most recent session
mu --session <path>   # Resume a specific session file
```

## Configuration

Config files follow XDG conventions:

| Path | Purpose |
|------|---------|
| `~/.config/mu/config.json` | Settings (baseUrl, model, maxTokens, temperature) |
| `~/.config/mu/SYSTEM.md` | System prompt |
| `~/.local/share/mu/sessions/` | Saved conversation sessions (JSONL) |
| `~/.cache/mu/repomap/` | Code index cache |

### Example `config.json`

```json
{
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen2.5",
  "maxTokens": 4096,
  "temperature": 0.7,
  "streamTimeoutMs": 30000
}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+S` | Send message |
| `Ctrl+C` | Abort / Quit (press twice) |
| `Esc` | Stop generation (press twice) |
| `↑` / `↓` | Navigate input history |
| `Ctrl+N` | New conversation |
| `Ctrl+M` | Cycle models |
| `Ctrl+O` | Model picker |
| `Ctrl+V` | Paste image from clipboard |
| `PageUp` / `PageDown` | Scroll |
| Mouse wheel | Scroll |

## Slash Commands

| Command | Action |
|---------|--------|
| `/model` | Select a model |
| `/sessions` | List project sessions |
| `/new` | New conversation |

## Features

- Streams responses with live token/s display
- Multi-turn tool calling (bash, read, write, edit files)
- Code indexing via `mu-repomap` plugin (auto-loaded)
- Image attachment support
- Session persistence and resume
- Mouse wheel scrolling

## License

MIT
