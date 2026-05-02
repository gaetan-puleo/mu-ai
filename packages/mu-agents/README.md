# mu-agents

Agent switcher and subagent orchestration plugin for [mu](../../README.md).

Adds a "primary agent" abstraction on top of the mu plugin system: each agent
ships with its own system prompt, allowed tool list, and color. Switch agents
inline with slash commands (`/build`, `/plan`, …) or `Tab` and the LLM sees
the new persona on its very next reply.

Also ships two tools for delegating to side agents:

- `subagent` — run a single subagent with an isolated task
- `subagent_parallel` — fan out N subagents concurrently

## Install

```bash
mu install npm:mu-agents   # once published, or load via workspace name
```

Add it to `~/.config/mu/config.json`:

```json
{
  "plugins": ["mu-agents"]
}
```

## Built-in agents

| Name    | Type     | Tools                                                                  |
|---------|----------|-------------------------------------------------------------------------|
| `build` | primary  | `bash`, `read_file`, `write_file`, `edit_file`, `subagent`, `subagent_parallel` |
| `plan`  | primary  | `read_file`, `search_code`                                              |
| `review`| subagent | `read_file`, `search_code`, `bash`                                      |

## Override / add agents

Drop `*.md` files in `~/.config/mu/agents/`. Frontmatter shape:

```markdown
---
name: refactor
description: Refactor without changing behaviour
agent: primary
tools: read_file, edit_file, search_code, bash
color: "#ff8c00"
---

You are the **refactor** agent. Improve readability and structure without
changing observable behaviour. Run the test suite after every batch of
edits and revert if anything fails.
```

`agent: subagent` makes the file a subagent (callable from the `subagent`
tool), `agent: primary` (default) makes it a switchable primary agent.

## Slash commands

- `/build`, `/plan`, … — switch to the named primary agent (one per agent)
- `/agent` — show the current agent
- `/agent <name>` — switch to `<name>`

## Mention autocomplete

Type `@` followed by a subagent name to get an autocomplete picker. The
LLM is instructed to interpret `@<name>` mentions as subagent dispatches
(via the `subagent` / `subagent_parallel` tools).

## Tab cycling

Tab cycles through primary agents when the input is empty. Inside a
`@mention` picker Tab accepts the highlighted completion.

## Persistence

Active agent is persisted at `~/.local/share/mu/agent-state.json` so the
next session resumes in the same mode.

## Programmatic use

```ts
import { createAgentsPlugin } from 'mu-agents';

const plugin = createAgentsPlugin({
  agentsDir: '/path/to/agents',
  settingsPath: '/path/to/state.json',
});
await registry.register(plugin);
```
