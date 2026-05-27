# mu-harness

Shared bootstrap layer that wires `mu-core` into a running host.
`bootstrap()` resolves XDG paths, loads plugins (workspace + npm + local
files), reads skills, sub-agents and permissions from disk, builds an
approval queue + permission hook, assembles the system prompt, and returns
the pieces a host needs to construct an `AgentRuntime`.

Hosts (currently `coding-agent` and `arya`) still own:

- the LLM provider plugin (host config),
- the transport (TUI, WebSocket, …),
- model state.

Also exports: `AgentRuntime` (multi-session runtime façade),
`createJsonlSessionStore`, `createCommandRegistry` + default `/agents`,
`/sessions`, `/help` commands, the scheduler plugin (`croner`-backed),
mentions/channels managers, sub-agent runner, and the plugin installer.
