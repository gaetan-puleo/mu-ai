# mu-tools

Filesystem + shell tools for mu-core runtimes. `createMuTools()` returns a
`Tools` map containing `read`, `write`, `edit`, `bash`, and `list_dir`.

Options:

- `getCwd` — working-directory accessor (default `process.cwd()`).
- `bashMaxOutputBytes` — cap on combined stdout/stderr (default 10 MiB).
- `getBashAbortSignal` — per-call abort source for `bash`.
