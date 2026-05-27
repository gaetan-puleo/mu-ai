# coding-agent

Terminal coding assistant built on `mu-core` + `mu-harness` + `mu-tui`. Uses
`mu-local-provider` (llama-swap) for inference and `mu-tools` for
filesystem + shell access. Sessions persist as JSONL under
`$XDG_DATA_HOME/coding-agent/sessions/`; plugins, skills, agents,
permissions load from `$XDG_CONFIG_HOME/coding-agent/`.

Run with `pnpm dev` (or `deno run -A --sloppy-imports bin/coding-agent.ts`).
`coding-agent install <npm:spec | path.ts>` adds a plugin;
`coding-agent -c` resumes the most recent session.
