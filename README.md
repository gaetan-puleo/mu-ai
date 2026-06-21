# mu

Minimal terminal AI coding agent for local models (llama-swap / llama.cpp).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/mu-ai/main/install.sh | sh
```

Installs the standalone `mu` binary to `~/.local/bin` (no Node needed).
On Windows, grab `mu-windows-x64.exe` from the [releases page](https://github.com/gaetan-puleo/mu-ai/releases/latest).

Or, if you have Node >= 24: `npm install -g mu-coding` (also published to npm).

## Configure

`~/.config/mu/config.json`:

```json
{
  "kind": "llama-swap",
  "baseUrl": "http://localhost:8080"
}
```

## Run

```bash
mu        # start
mu -c     # resume the last session
```

Type to chat. `@file`/`@agent` to mention, `!cmd` to run a shell command,
`/` for commands (`/new`, `/sessions`, `/model`, `/thinking`, `/expand`,
`/voice`, `/call`, `/context-export`, `/quit`).
`/voice` dictates one clip into the composer and `/call` is hands-free realtime
dictation — both need a microphone recorder (ffmpeg / arecord / parecord) and an
audio-capable model, or `voiceModel` set to one. `Tab` cycles the agent,
`Esc Esc` cancels, `Ctrl+T` toggles the theme.

## Packages

```
core/            # agent loop: messages, tools, provider, createAgent
harness/         # sessions, agents, skills, sub-agents, permissions, scheduler, plugins, chat TUI
tui/             # terminal UI engine (parser, layout, components)
tools/           # read, write, edit, bash, list
local-provider/  # llama-swap / llama.cpp provider
webfetch/        # URL → markdown tool
coding-agent/    # the `mu` CLI
```

## Develop

pnpm workspace (Node >= 22):

```bash
pnpm install       # install workspace deps
pnpm dev           # run the mu CLI from source (tsx)
pnpm test          # vitest, all packages
pnpm check         # type-check (tsc) all packages
pnpm -r build      # build every package to dist/ (tsup)
```

## License

MIT
