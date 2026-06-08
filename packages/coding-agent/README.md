# coding-agent

Terminal coding assistant built on `mu-core` + `mu-harness` + `mu-tui`. Uses
`mu-local-provider` (llama-swap) for inference and `mu-ai-tools` for
filesystem + shell access. Sessions persist as JSONL under
`$XDG_DATA_HOME/coding-agent/sessions/`; plugins, skills, agents,
permissions load from `$XDG_CONFIG_HOME/coding-agent/`.

Run with `pnpm dev` (or `deno run -A --sloppy-imports bin/coding-agent.ts`).
`coding-agent install <npm:spec | path.ts>` adds a plugin;
`coding-agent -c` resumes the most recent session.

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
`/` for commands (`/new`, `/model`, `/thinking`, `/quit`). `Tab` cycles the
agent, `Esc Esc` cancels, `Ctrl+T` toggles the theme.

## Packages

```
core/            # agent loop: messages, tools, provider, createAgent
harness/         # sessions, agents, skills, sub-agents, permissions, scheduler, plugins, chat TUI
tui/             # terminal UI engine (parser, layout, components)
tools/           # read, write, edit, bash, list_dir
local-provider/  # llama-swap / llama.cpp provider
webfetch/        # URL → markdown tool
coding-agent/    # the `mu` CLI
```

## Develop

```bash
den o install       # workspace deps into node_modules (manual mode)
den o task dev      # run from source
den o task test
den o task check
```

## License

MIT
