# mu-ai-tools

Filesystem + shell tools for mu-core runtimes. `createMuTools()` returns a
`Tool[]` array containing the `read`, `write`, `edit`, `bash`, and `list` tools.

Options:

- `getCwd` — working-directory accessor (default `process.cwd()`).
- `bashMaxOutputBytes` — cap on combined stdout/stderr (default 10 MiB).
- `getBashAbortSignal` — per-call abort source for `bash`.
