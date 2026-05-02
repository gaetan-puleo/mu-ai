# mu-coding

Minimal terminal AI assistant for local models. A TUI chat interface with tool-calling support, built with Ink and React.

## Install

```bash
npm install -g mu-coding
```

## Usage

```bash
mu                    # Start interactive chat
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

### Theming

The `theme` field selects the UI palette. Either name a built-in preset:

```json
{ "theme": "solarized-dark" }
```

Built-in presets: `dark` (default), `light`, `solarized-dark`, `monochrome`.

Or pass an object to override individual leaves on top of a preset:

```json
{
  "theme": {
    "preset": "dark",
    "input":  { "background": "#1e1e2e", "cursor": "#f5c2e7" },
    "user":   { "border": "magenta" },
    "common": { "accent": "#89dceb" }
  }
}
```

Color values accept Ink's named colors (`red`, `green`, `cyan`, `yellow`,
`magenta`, `blue`, `white`, `black`, `gray`) or hex strings (`#1a1a1a`).

Sections available: `input`, `user`, `assistant`, `tool`, `reasoning`,
`modal`, `toast`, `dropdown`, `dialog`, `diff`, `status`, `common`. See
`src/tui/theme/types.ts` for the full leaf list.

## Keyboard Shortcuts

### Input editing

| Key | Action |
|-----|--------|
| `←` / `→` | Move cursor one character |
| `Ctrl+←` / `Ctrl+→` (or `Alt+←/→`) | Move cursor by word |
| `Home` / `End` (or `Ctrl+A` / `Ctrl+E`) | Jump to start / end of line |
| `↑` / `↓` | Move cursor between lines (multi-line buffer); navigate history at edges |
| `Backspace` | Delete char before cursor |
| `Delete` | Delete char under cursor |
| `Ctrl+W` | Delete previous word |
| `Ctrl+U` | Delete from start of line to cursor |
| `Ctrl+K` | Delete from cursor to end of line |

### Submission & app

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` (or `Ctrl+J`) | New line |
| `Ctrl+S` | Send message |
| `Ctrl+C` | Abort / Quit (press twice) |
| `Esc` | Stop generation (press twice) |
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
- Optional code indexing via the `mu-repomap` plugin (enable via `config.plugins`)
- Optional default agents (build/plan/explore/review) via `mu-coding-agents` (enable via `config.plugins`)
- Image attachment support
- Session persistence and resume
- Mouse wheel scrolling

## License

MIT
