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
mu -b <baseUrl>       # Override the provider base URL
```

## Configuration

Config files follow XDG conventions:

| Path | Purpose |
|------|---------|
| `~/.config/mu/config.json` | Settings (baseUrl, model, maxTokens, temperature) |
| `~/.config/mu/SYSTEM.md` | System prompt override (replaces the bundled default identity prompt; plugin-contributed prompts still append below) |
| `~/.local/share/mu/sessions/` | Saved conversation sessions (JSONL) |
| `~/.cache/mu/repomap/` | Code index cache |

### Example `config.json`

```json
{
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen2.5",
  "maxTokens": 4096,
  "temperature": 0.7,
  "streamTimeoutMs": 30000,
  "plugins": ["mu-coding-agents", "mu-agents"]
}
```

### Plugins

`plugins` is an optional array of plugin names to enable. Supported values:

| Name | What it adds |
|------|--------------|
| `mu-agents` | Agents runtime: `@mention` dispatch, permission gating, sub-agent tools |
| `mu-coding-agents` | Bundled `build` / `plan` / `explore` / `review` agents. Requires `mu-agents` to also be listed. |

File/shell tools (`read`, `write`, `edit`, `bash`, `list_dir`) are always
available — no need to list them. Unknown names are ignored with a warning.

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
| `/help` | Show available commands |
| `/quit` | Exit the TUI |
| `/new` | Start a new conversation (the previous one stays saved) |
| `/sessions` | List and resume saved sessions |

## Sessions

Each conversation is saved as a JSONL file under
`$XDG_DATA_HOME/mu/sessions/` (default: `~/.local/share/mu/sessions/`). The
first line is a session header (id, cwd, model, …); subsequent lines are the
appended messages. Writes are append-only — messages flagged `transient` are
skipped so replay produces a clean transcript.

- `/new` opens a fresh session file. The previous conversation remains
  accessible via `/sessions`.
- `/sessions` opens a chronological picker. Selecting a session resumes it:
  the on-screen transcript is rebuilt from disk and further messages are
  appended to the same file.

When `mu-agents` + `mu-coding-agents` are enabled, mention an agent by name to
switch for one turn — e.g. `@plan refactor the session store`. The agent
loaded first (alphabetical scan of `*.md`) is the default.

## Approvals

Some agents (e.g. `build`) mark certain tool calls as requiring approval. When
that happens, the TUI shows a modal:

| Key | Action |
|-----|--------|
| `y` / `Enter` | Approve once |
| `a` | Approve for this session (remembered until you exit) |
| `n` / `Esc` | Deny |

## Features

- Streams responses with live token/s display
- Multi-turn tool calling (`bash`, `read`, `write`, `edit`, `list_dir`)
- Optional default agents (`build` / `plan` / `explore` / `review`) via `mu-coding-agents` (enable via `config.plugins`)
- Approval modal for gated tool calls
- Mouse wheel scrolling

## License

MIT
