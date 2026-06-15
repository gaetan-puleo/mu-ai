# coding-agent

Terminal coding assistant built on `mu-core` + `mu-harness` + `mu-tui`. Uses
`mu-local-provider` (llama-swap) for inference and `mu-ai-tools` for
filesystem + shell access. Sessions persist as JSONL under
`$XDG_DATA_HOME/mu/sessions/`; plugins, skills, agents,
permissions load from `$XDG_CONFIG_HOME/mu/`.

Run with `deno task dev` (or `deno run -A --sloppy-imports bin/coding-agent.ts`).
`mu install <npm:spec | jsr:spec | ./path.ts>` adds a plugin;
`mu -c` resumes the most recent session.

---

## Project README

# mu

Minimal terminal AI coding agent for local models (llama-swap / llama.cpp).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/mu-ai/main/install.sh | sh
```

Installs the standalone `mu` binary to `~/.local/bin` (no Deno/Node needed).
On Windows, grab `mu-windows-x64.exe` from the [releases page](https://github.com/gaetan-puleo/mu-ai/releases/latest).

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
`/voice`, `/call`, `/context-export`, `/quit`). `/voice` dictates one clip into
the composer and `/call` is hands-free realtime dictation — both need a
microphone recorder (ffmpeg / arecord / parecord) and an audio-capable model,
or `voiceModel` set to one. `Tab` cycles the agent, `Esc Esc` cancels,
`Ctrl+T` toggles the theme.

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

```bash
deno install       # workspace deps into node_modules (manual mode)
deno task dev      # run from source
deno task test
deno task check
```

## License

MIT
