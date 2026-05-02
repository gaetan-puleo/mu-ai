# mu-coding-agents

Default coding agent definitions packaged as a mu plugin. Registers four
agents:

- `build` (primary) — execute code changes
- `plan` (primary) — read-only planning
- `explore` (subagent) — focused codebase exploration
- `review` (subagent) — diff / commit review

The plugin only points the host's agent source registry at this package's
`agents/` directory; the `.md` files carry the prompts and permission maps.

## Usage

```ts
import { startMu } from 'mu-core';
import openai from 'mu-openai-provider';
import agents from 'mu-agents';
import codingAgents from 'mu-coding-agents';

await startMu({
  configPath: '~/.config/mu/config.json',
  plugins: [openai(), agents(), codingAgents()],
});
```
