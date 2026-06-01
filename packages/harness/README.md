# mu-harness

Packages the `mu-core` agent loop into a running host. `createHarness(options)`
resolves XDG paths, builds a model registry from the host's providers, loads
agents and skills (from the host, plugins, disk, and the cwd), wires sub-agents,
persistent sessions, slash commands, and an optional scheduler — then returns a
`Harness` the host drives.

```ts
import { createHarness } from 'mu-harness';

const harness = await createHarness({
  hostName: 'mu',
  xdg: { configHome, dataHome, stateHome },
  providers: { anthropic: myProvider },
  model: 'anthropic/claude',
});

const session = harness.sessions.create({ cwd });
await session.send('hello');
```

## What `createHarness` wires

- **Config** — `configDir`/`dataDir`/`stateDir` under the XDG homes, namespaced by `hostName`.
- **Models** — a `ModelRegistry` over the host's `providers`; refs are `"provider/model"`, with a selectable default.
- **Agents** — merged from host options, plugins, and `configDir/agents/*.md` (frontmatter personas, with `extends`).
- **Skills** — merged from host options, plugins, `cwd/skills`, and `configDir/skills` (`SKILL.md` dirs); exposed via the `skill` and `create_skill` tools.
- **Sub-agents** — a `subagent` tool plus a registry hosts can observe; sub-agent turns persist to the same session store.
- **Sessions** — JSONL message store + a SQLite catalog, behind a `SessionManager` (`create` / `open` / `fork` / `list` / `delete`) with automatic background titling.
- **Commands** — a registry with `/agents`, `/skills`, `/sessions`, `/help` (and `/tasks` when the scheduler is on).
- **Scheduler** _(opt-in via `scheduler: true`)_ — a `TaskStore` plus the `run_skill` and `schedule_task` tools, backed by a built-in croner engine (`scheduler/engine`).

## What hosts still own

- the LLM provider implementation(s) passed as `providers`,
- the transport (the `tui` export ships a composable chat app, or bring your own),
- when to `select` a model and which session/channel to surface.

## Also exported

`createAgentSession` and the session stores/catalog; the hooks layer
(`mergeHooks`, `withHooks`); permissions (`allowList`, `requireApproval`);
the plugin types and `definePlugin`; the channels managers; and `tui`
(`createChatApp` / `runChat` and the overridable component kit + slots).
