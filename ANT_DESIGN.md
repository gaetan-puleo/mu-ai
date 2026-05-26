# Ant — Framework Design

A framework for building agents. Two reference agents will ship on top of it:
**mu** (terminal-native coding agent) and **Arya** (jarvis-like assistant with mobile companion).

Everything below is the design we converged on. Open questions are listed at the end.

---

## 1. Products

| Name | What it is |
|---|---|
| **Ant** | The framework. Multiple subpackages (substrate, capabilities, meta). |
| **mu** | A coding agent built on Ant. Terminal-first. |
| **Arya** | A jarvis-like agent built on Ant. WebSocket server + mobile companion. Also has a local TUI. |

Mu and Arya are *agents* (deployable products). They differ in personality, channels, and extras.
Everything they share lives in Ant.

---

## 2. Repo layout

One monorepo. Three top-level product folders. Flat package naming (no npm `@scope/`).

```
repo/
  ant/
    core/                  → "ant-core"
    agents/                → "ant-agents"
    local-provider/        → "ant-local-provider"
    tools/                 → "ant-tools"
    webfetch/              → "ant-webfetch"
    session-store/         → "ant-session-store"
    tui/                   → "ant-tui"          (engine + chat shell as sub-export)
    main/                  → "ant"              (meta / createAgent boilerplate)

  mu/
    (one package initially: built-in coding agents + TUI wiring + commands)
    Subpackages extracted as pieces grow.

  arya/
    server/                → "arya-server"      (Node WS backend + local TUI)
    companion/             → "arya-companion"   (Expo / React Native mobile app)
    (built-in jarvis agents and the WS channel plugin live inside server/ initially)
```

**Total Ant packages: 8 today.** (`ant-scheduler` and `ant-skills` stay inside their consuming agent until a second agent needs them.)

---

## 3. Layering and the OCP posture

Four layers. Each has a distinct posture for changes.

| Layer | What it is | Posture |
|---|---|---|
| **Core** (`ant-core`) | Substrate: loop, bus, runtime, host, plugin contract, types, pure helpers | **Closed to modification.** Substrate rarely changes. |
| **Capability packages** (`ant-agents`, `ant-tools`, `ant-webfetch`, `ant-local-provider`, `ant-session-store`, `ant-tui`, …) | Each owns one capability. Plug into the runtime as plugins. | **Open to extension.** Add new ones without modifying existing ones. |
| **Meta** (`ant`) | Composes capabilities with sensible defaults. Loads config, discovers user agents/plugins, installs lifecycle. | **Open to override.** Every default is reachable through an option. |
| **Apps** (`mu`, `arya/server`, `arya/companion`) | Configure the meta. Add their own agents, channels, extras. | Thin. |

**Rule of thumb:** never patch an existing package to extend behavior. Add a new capability package, contribute via the plugin contract, override meta decisions via `createAgent` options.

---

## 4. Core types and primitives

All types and pure helpers live in `ant-core`.

### Types

| Type | Shape |
|---|---|
| `Message` | `{role: 'system' \| 'user' \| 'assistant' \| 'tool' \| 'reasoning', content, tool_calls?, tool_id?}` |
| `ToolCall` | `{id, tool, args}` |
| `Tool` | `{name, description, parameters, execute, onError?, matchKey?, formatArgs?, systemPrompt?}` |
| `ToolHooks` | `{beforeTool?, afterTool?}` — composable middleware |
| `LLMResponse` | `{content?, reasoning?, tool_calls?, context?}` |
| `LLMStreamEvent` | `'delta' \| 'reasoning_delta' \| 'tool_call' \| 'done'` |
| `LLMProvider` | `(messages, tools) => Promise<LLMResponse \| AsyncIterable<LLMStreamEvent>>` |
| `Agent` | `{name, description, prompt, tools, permissions?, color?, kind}` |
| `Action` | `'allow' \| 'deny' \| 'ask'` |
| `Permission` | `Action \| Record<string, Action>` (glob keys) |
| `SlashCommand` | `{name, description?, run(args, runtime)}` |
| `CoreEvent` | discriminated union of all bus events (see below) |
| `Plugin` | declarative POJO (see §5) |

### Pure helpers (zero I/O)

- `createBus<T>()` — pub/sub event bus
- `createRuntime(config)` — one conversation's loop
- `createHost({plugins})` — multi-runtime host
- `callTool(tool, args, hooks)` — wraps tool execution
- `parseAgentMd(text)` — markdown+YAML → `Agent`
- `parsePermissions(raw)` — YAML shape → `Permission` map
- `globMatch(input, pattern)` — for permission rules
- `resolveAction(perm, matchKey)` — pure resolution

`parseMention(text)` lives in `ant-agents` since `@` is `@agent` — agent-specific.

### `CoreEvent`

```ts
type CoreEvent =
  | { type: 'user_message';      message: Message }
  | { type: 'steer';              message: Message }
  | { type: 'follow_up';          message: Message }
  | { type: 'assistant_start' }
  | { type: 'assistant_delta';    content: string }
  | { type: 'assistant_message';  message: Message }
  | { type: 'reasoning_delta';    content: string }
  | { type: 'reasoning_message';  message: Message }
  | { type: 'tool_call';          call: ToolCall }
  | { type: 'tool_result';        message: Message }
  | { type: 'context_update';     context: LLMResponseContext }
  | { type: 'approval_request';   id, agent, tool, args, matchedRule, argLines? }
  | { type: 'approval_response';  id, outcome: 'approve' | 'deny', remember? }
  | { type: 'agent_switched';     from?: string, to: string, reason: string }
  | { type: 'error';              error: unknown };
```

---

## 5. The Plugin contract

```ts
interface Plugin {
  name: string;
  tools?: Record<string, Tool>;
  agents?: Agent[];
  commands?: SlashCommand[];
  hooks?: ToolHooks;
  provider?: ProviderFactory;
  onStart?(host: Host): void | Promise<void>;
  onStop?(host: Host): void | Promise<void>;
}
```

**Everything is declarative for consistency.** The host merges all `tools`, `agents`, `commands`, `hooks` at start. Adding a contribution is adding a field value, not a method call.

**`onStart(host)`** is the dynamic surface for plugins that need to subscribe to runtimes, wire transports, or aggregate from other plugins.

**No `PluginAPI` indirection.** No `register(api)` callback. Plugins are POJOs; host introspects them.

---

## 6. Runtime and Host

### Runtime — one conversation

```ts
interface Runtime {
  id: string;
  bus: EventBus<CoreEvent>;
  messages: ReadonlyArray<Message>;
  state(): 'idle' | 'running' | 'stopped';
  send(msg: Message): void;
  steer(msg: Message): void;
  followUp(msg: Message): void;
  stop(): Promise<void>;
  on(fn: (e: CoreEvent) => void): Unsubscribe;
}
```

No `Session` wrapper. `Runtime` *is* the conversation — has identity, exposes its bus and transcript directly, and provides convenience methods over the bus (`send` is sugar over publishing `user_message`).

### Host — multi-runtime container

```ts
interface Host {
  plugins: Plugin[];
  createRuntime(opts?): Runtime;
  getRuntime(id: string): Runtime | undefined;
  onRuntime(fn: (rt: Runtime) => void): Unsubscribe;
  dispatchCommand(name, args, runtime): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

`createHost({plugins})` does these at construction:
1. Merge all `plugin.tools` → host's tool map.
2. Merge all `plugin.agents` → handed to the agents plugin via its `onStart`.
3. Merge all `plugin.commands` → host's command map.
4. Compose all `plugin.hooks` → middleware chain.
5. Resolve `plugin.provider` → exactly one, else throw.

`host.start()` then runs each plugin's `onStart(host)` in declaration order.

`host.stop()` runs each plugin's `onStop(host)` in reverse order, plus stops every runtime.

---

## 7. Capability packages

### `ant-agents`

Owns the entire "agent dimension":

- Registry built from every plugin's `agents` field
- Active-agent state per runtime
- System prompt injection (active agent's `prompt` flows into each turn)
- Tool allowlist enforcement (active agent's `tools` filters available tools)
- Permission gating via `hooks.beforeTool` and the bus approval flow
- Sub-agent runner + `subagent` / `subagent_parallel` tools
- `@`-mention parsing + `getMentions()`
- Agent switching + `agent_switched` events

These are **intrinsic** to what makes an agent. Not toggleable modules.

```ts
const agents = createAgentsPlugin({
  defaultAgent?: string;        // who's active when a runtime starts
  approvalTimeoutMs?: number;   // optional: auto-deny after N ms
});
```

`createAgentsPlugin` returns a `Plugin` augmented with public methods consumers can call:

```ts
type AgentsPlugin = Plugin & {
  getMentions(partial: string): AgentMention[];
  list(): Agent[];
  get(name: string): Agent | undefined;
  getActive(runtimeId: string): Agent | undefined;
  setActive(runtimeId: string, name: string): boolean;
};
```

The framework only reads the `Plugin` fields; extras are for app code holding a reference.

### `ant-local-provider`

OpenAI-compatible HTTP provider. Probes for llama-swap-specific endpoints
(`/upstream/.../slots|tokenize|props`) and enriches `ContextSummary` when present.
Works with OpenAI, Anthropic-via-proxy, Ollama, LM Studio, llama-swap, vLLM, OpenRouter, etc.

```ts
createLocalProvider({ baseUrl, apiKey?, model });
```

### `ant-tools`

Generic filesystem and shell tools: `bash`, `edit`, `read`, `write`, `list_dir`.

Security baked in: `sanitizePath` uses `path.relative` + symlink resolution; `bash` has output cap + SIGTERM-then-SIGKILL + exit-code reporting; `edit` uses slice-based replacement (no `$&` expansion); `read` checks size + binary; `write` atomic + symlink check.

`matchKey` and `formatArgs` on every tool — used by approval UIs and permission rules.

### `ant-webfetch`

`webfetch` tool: URL → markdown (Turndown) or text. Redirect cap + scheme validation, content-type and size limits, configurable timeout/UA/cap via factory args.

### `ant-session-store`

Plugin that subscribes to `host.onRuntime` and persists each runtime's transcript as JSONL + atomic meta sidecar. Schema-versioned. Exposes `list/load/summarise/rename/delete` as public methods on the returned plugin object.

```ts
createSessionStorePlugin({ dir });
```

### `ant-tui`

Zero-dep terminal UI: cell buffer, layout engine, ANSI emission, components (`Box`, `Text`, `Input`, `Modal`, `ScrollView`, `SelectList`, …), keyboard parsing.

The **chat shell** (`Transcript`, `InputBar`, `CommandPalette`, standard message blocks) is a sub-export — `import { createTuiChatPlugin } from 'ant-tui/chat'`. Apps that want non-chat TUIs use only the engine.

```ts
const tui = createTui(opts);                       // engine
const chat = createTuiChatPlugin({ tui, agents }); // chat shell as a Plugin
```

The chat plugin wires:
- Subscribes to `host.onRuntime` → renders each runtime's events
- Keyboard input → `runtime.send(...)`
- `/cmd args` typed → `host.dispatchCommand(name, args, runtime)`
- `@partial` typed → `agents.getMentions(partial)` → completions menu
- `approval_request` on runtime bus → modal → publishes `approval_response`

---

## 8. `ant` — the meta package

The composition layer. Apps call `createAgent(opts)`; the meta:
1. Loads config (XDG path conventions + env vars with `<NAME>_*` prefix)
2. Discovers user-defined agents (from disk) and merges with built-ins (user wins by name)
3. Discovers user-defined plugins (from disk; dynamic import)
4. Builds the default plugin set
5. Hands `{plugins}` to `createHost`
6. Runs `host.start()`
7. Installs signal handlers + `uncaughtException`/`unhandledRejection` that gracefully stop

Every step is overridable:

```ts
function createAgent<C>(opts: {
  name: string;
  configDefaults: C;
  configSchema?: (raw: unknown) => C;

  // App's required contributions
  channels: Plugin[];           // TUI plugin, WS plugin, etc.
  agents: Agent[];              // app's built-in personas
  extraPlugins?: Plugin[];      // skills, scheduler, custom

  // Override points (all optional, all default sensibly)
  config?: C | (() => Promise<C>);
  userAgents?: false | (() => Promise<Agent[]>);
  userPlugins?: false | (() => Promise<Plugin[]>);
  plugins?: (defaults: Plugin[], cfg: C) => Plugin[];
  signalHandlers?: boolean;
}): Promise<App>;
```

The app gets back:

```ts
interface App<C> {
  config: C;
  host: Host;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### CLI helpers exported from `ant`

```ts
antInit(name: string, template?: string): Promise<void>;
antInstall(name: string, spec: string): Promise<void>;
antUninstall(name: string, spec: string): Promise<void>;
```

Each agent's `bin/` script dispatches these as subcommands. Not a separate CLI package.

---

## 9. Key flows

### Startup

```
app → createAgent({channels, agents, extraPlugins, ...})
  meta loads config (XDG + env) unless overridden
  meta discovers user agents from disk → wraps as an agents-contributing plugin
  meta discovers user plugins from disk → dynamic import
  meta builds defaultPlugins = [
    agentsPlugin, localProvider, antTools, antWebfetch, antSessionStore
  ]
  if opts.plugins: finalPlugins = opts.plugins(defaultPlugins, cfg)
  else: finalPlugins = defaultPlugins
  finalPlugins = finalPlugins + opts.channels + opts.extraPlugins + userPluginsPlugin
  createHost({plugins: finalPlugins})
  for each plugin: await plugin.onStart(host)
  install signal handlers (unless disabled)
```

### A turn (user → assistant)

```
transport plugin (TUI/WS) sees input
  → runtime.send({role:'user', content})
  → runtime.bus.publish({type:'user_message', message})
  → runtime's loop wakes:
      buildProviderMessages:
        - active agent's system prompt (injected by ant-agents)
        - tool's systemPrompt suffixes
        - transcript
      provider(messages, allowedTools) → stream
      for each event:
        'delta'           → bus.publish('assistant_delta')
        'reasoning_delta' → bus.publish('reasoning_delta')
        'tool_call'       → callTool(tool, args, hooks)
                              hooks.beforeTool (ant-agents gateway: allow/deny/ask)
                              tool.execute(args)
                              hooks.afterTool
                              push tool message
                              bus.publish('tool_result')
        'done'            → finalize
                              push assistant message
                              bus.publish('assistant_message')
transport plugin's bus subscription renders each event
ant-session-store's bus subscription persists each event
```

### A slash command

```
TUI input is "/quit foo"
  → chat shell parses → host.dispatchCommand('quit', 'foo', activeRuntime)
  → host.commands.get('quit').run('foo', activeRuntime)
```

### Sub-agent invocation

```
LLM emits tool_call: subagent({agent:'explore', task:'find X'})
  → runtime executes subagentTool
  → subagentTool (from ant-agents):
      host.createRuntime({meta:{parentId, agentName:'explore'}})
      child.send({role:'user', content:task})
      subscribe to child.bus until assistant_message
      on parent.stop, propagate to child.stop
      return child's final content as the tool's result
  → parent runtime gets result → next turn
```

### Permission ask (approval over bus)

```
hooks.beforeTool (ant-agents) runs:
  resolveAction(agent.permissions[tool], matchKey)
  → action === 'ask'
  → id = newId()
  → runtime.bus.publish({type:'approval_request', id, agent, tool, args, matchedRule, argLines})
  → register a pending Promise keyed by id (with optional timeout → auto-deny)

  All transports subscribed to runtime.bus see the request:
    TUI chat plugin → pops modal → user clicks "Approve, remember"
      → publishes {type:'approval_response', id, outcome:'approve', remember:true}
    WS plugin → forwards request to mobile clients
      → first response published as approval_response

  ant-agents sees approval_response with matching id:
    → resolves pending Promise
    → if 'remember': stores rule in session's allow list
    → original tool_call proceeds, or blocked with reason
```

No `ApprovalChannel` type. No `tuiApprovalChannel` / `wsApprovalChannel`. Whatever channel is on the runtime renders approvals through normal bus subscription.

### Scheduler tick (if `ant-scheduler` is loaded)

```
cron fires for task t:
  → host.getRuntime(`task:${t.id}`) ?? host.createRuntime({id})
  → rt.send({role:'user', content: t.prompt})
  → consume runtime.bus until 'assistant_message' or 'error'
  → emit task event via app-provided callback
```

---

## 10. Mu and Arya

### Mu (terminal coding agent)

```ts
// mu/src/index.ts
import { createAgent } from 'ant';
import { createAgentsPlugin } from 'ant-agents';
import { createTui } from 'ant-tui';
import { createTuiChatPlugin } from 'ant-tui/chat';
import { codingAgents } from './agents';
import { codingCommands } from './commands';
// optional, if mu owns skills locally:
import { createSkillsPlugin } from './skills';

const tui = createTui();
const agents = createAgentsPlugin({ defaultAgent: 'coding' });
const tuiChat = createTuiChatPlugin({ tui, agents });

await createAgent({
  name: 'mu',
  configDefaults: { baseUrl: 'http://localhost:8080/v1', model: undefined },
  channels: [tuiChat],
  agents: codingAgents,                          // declarative built-ins
  extraPlugins: [
    { name: 'mu-commands', commands: codingCommands },
    createSkillsPlugin(),
  ],
});
```

### Arya server (jarvis with TUI + WS)

```ts
// arya/server/src/index.ts
import { createAgent } from 'ant';
import { createAgentsPlugin } from 'ant-agents';
import { createTui } from 'ant-tui';
import { createTuiChatPlugin } from 'ant-tui/chat';
import { createWsChannelPlugin } from './ws-channel';
import { jarvisAgents } from './agents';
// optional, if arya owns scheduler locally:
import { createSchedulerPlugin } from './scheduler';

const tui = createTui();
const agents = createAgentsPlugin({ defaultAgent: 'jarvis' });
const tuiChat = createTuiChatPlugin({ tui, agents });
const ws = createWsChannelPlugin({ port: 3001, authToken: cfg.authToken });

await createAgent({
  name: 'arya',
  configDefaults: { baseUrl: '', wsPort: 3001, authToken: '' },
  channels: [tuiChat, ws],
  agents: jarvisAgents,
  extraPlugins: [createSchedulerPlugin({ tasks: loadTasksYaml() })],
});
```

Both channels share the same in-memory runtimes — open the mobile app and the local TUI shows the same sessions live.

### Arya companion (mobile)

Stays a separate Expo/RN app. Talks to `arya/server` over WebSocket. The wire protocol is whatever `createWsChannelPlugin` exposes (a thin event-passthrough on top of `CoreEvent`).

---

## 11. What we explicitly cut

| Cut | Reason |
|---|---|
| `Session` class | Renamed-Runtime with marginal additions. `Runtime` exposes `id`, `bus`, `messages`, `send` directly. |
| `Channel` interface | Transports are just plugins with `onStart`. No abstraction needed. |
| `PluginAPI` / `register(api)` | Plugins are POJOs; host introspects their declarative fields. |
| `ApprovalChannel` interface | Approvals are bus events. Whatever transport is on the runtime renders them. |
| `ant-sessions` package | Folded into `ant-core`. Substrate is one thing. |
| `ant-agent-md` package | `Agent` type + parser live in `ant-core` for consistency with `Tool`. |
| `ant-permissions` package | Pure helpers in `ant-core`; gateway behavior in `ant-agents`. |
| `ant-subagent` package | Merged into `ant-agents` (shares the registry, lives or dies together). |
| `ant-tui-chat` as standalone | Sub-export of `ant-tui`. Chat shell ships in the same package as the engine. |
| `ant-scheduler` as Ant package | Stays inside Arya until a second agent needs cron. |
| `ant-skills` as Ant package | Stays inside Mu until a second agent needs skills. |
| Mentions in core | Lives in `ant-agents` — `@` is `@agent`, agent-specific. |
| Switch tracker as separate concept | Just an event on the bus (`agent_switched`). |
| Multi-provider packages | One `ant-local-provider` covers all OpenAI-compatible endpoints + llama-swap probe. |
| Decorative emoji + box-drawing in tool output | Tool output stays plain ASCII; presentation is the consumer's job. |

---

## 12. The 8 Ant packages (recap)

| # | Package | One-line responsibility |
|---|---|---|
| 1 | `ant-core` | Substrate: types, pure helpers, runtime, host, plugin contract |
| 2 | `ant-agents` | Agent registry + active-agent + permissions gateway + subagent + mentions |
| 3 | `ant-local-provider` | OpenAI-compat HTTP provider + llama-swap probe |
| 4 | `ant-tools` | bash, edit, read, write, list_dir |
| 5 | `ant-webfetch` | URL → markdown |
| 6 | `ant-session-store` | JSONL persistence plugin |
| 7 | `ant-tui` | Terminal engine + chat shell (sub-export) |
| 8 | `ant` | Meta: `createAgent` + CLI helpers |

Plus: `mu` (1), `arya/server` (1), `arya/companion` (1). Total: 11 packages today, growing only when justified.

---

## 13. Open questions

**A. Lifecycle hook set.** Today's `hooks` are `beforeTool` / `afterTool`. Do we need `beforeTurn` / `afterTurn` for plugins that want to inject context or post-process? Add when a concrete need shows up.

**B. Module augmentation vs declarative fields.** Plugin's fields are currently hardcoded (`tools`, `agents`, `commands`, `hooks`, `provider`). If a brand-new capability type is added later (e.g., `contextProviders`), it requires modifying `Plugin` in core. Two options when that day comes:
  - Add the field (small breaking change, propagate).
  - TypeScript declaration merging from the new package.

Decide if/when it becomes a real problem.

**C. Where does `commands` live — `ant-core` or extension?** Currently in core (`Plugin.commands?`, `host.dispatchCommand`). Defensible because commands are universal to interactive sessions and tightly coupled to runtimes. Could move to an `ant-commands` capability if commands turn out to be optional — but every interactive deployment uses them, so probably stay in core.

**D. User-overridable defaults — how deep?** The meta's `plugins: (defaults) => Plugin[]` lets apps filter/reorder/swap. Is that enough, or do we want per-default-plugin overrides (e.g., "skip the session-store" as a flag)?

**E. Hook composition order.** Multiple plugins can declare `hooks.beforeTool`. Run order = plugin declaration order? Or explicit priority? Today: declaration order, first-block wins. Confirm.

**F. Single-process vs daemon for Arya.** Current plan: one `arya` process runs both TUI and WS. Future option: split into `arya` (daemon, WS only) + `arya-cli` (TUI client over WS). Not blocking; add when needed.

**G. Built-in agents — TS modules or markdown?** Both. Apps ship TS-typed built-ins via `agents: [...]`. Users can override by name with markdown files in `~/.config/<name>/agents/*.md`. Meta merges; user wins on name collision.

**H. Mention syntax beyond `@agent`.** If skills, commands, files ever want completion, they go through their own mechanisms (`/cmd` for commands, custom popovers for files, no `@skill` syntax). Keep `@` reserved for agents.

---

## 14. Migration / phasing (rough)

The current `mu` repo will become `ant/` plus `mu/` after a port. Migration steps:

1. **Restructure repo**: move current `packages/core`/`tools`/`webfetch`/`local-provider`/`tui` into `ant/core/`, `ant/tools/`, etc. Rename packages with `ant-` prefix.
2. **Extract `ant-agents`** from the deleted-commit history (port `parseAgentMd`, permissions, approval, subagent runner) and the current `coding-agent` (active-agent UX). Apply the runtime state-machine + tool-call fixes from the prior code review while porting.
3. **Build `ant`** (meta): port config/loader/install from current `coding-agent`. Add lifecycle handlers.
4. **Migrate `coding-agent` → `mu`**: delete its `AgentRuntime` wrapper and `RoundtripStore`, wire to `createAgent` + `createTuiChatPlugin`. Move `Diff` component into mu.
5. **Bring in Arya**: rewire `arya/server` against `createAgent`. Replace its `store.ts` with `ant-session-store`. Replace ad-hoc command dispatch with `host.dispatchCommand`. Replace `pendingApprovals` map with bus-based approval flow. Add a local TUI channel.
6. **Companion**: keep as-is; only the wire protocol (WS plugin) needs alignment.

Issues from the earlier security/quality reviews (bash unrestricted, sanitizePath symlink/Windows bug, edit `$&` expansion, WS auth, etc.) are fixed during the port to avoid carrying bugs into the new shape.

---

*Last updated as we refine. Push back on any decision and we update the doc.*
