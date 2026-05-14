# mu — Architecture

Layered design. Each layer owns ONE concern; nothing reaches across.

## Layers

| Layer | Charter | Owns | Must NOT |
|---|---|---|---|
| **L1 — `mu-core`** (SDK) | Generic agent runtime. Channel/host agnostic. | `PluginRegistry`, `SessionManager`, `ChannelRegistry`, `ProviderRegistry`, `ActivityBus`, `SessionStore` + `attachAutoPersist`, session-scoped `MessageBus`, `runHostTurn`, message factories, `projectMessage`, session grouping, utilities (`prettyToolArgs`, `formatDuration`, `readMeta*`), strict `ChatMessageMeta`. | Know about agents, tools, channels, or UI. |
| **L2 — mu plugins** (`mu-agents`, `mu-tools`, `mu-scheduler`, `mu-local-provider`, `mu-openai-provider`, `mu-repomap`, …) | Domain logic. Plug into L1 via `Plugin`. | mu-agents: state machines for agents + sub-agent runs + approvals (with snapshot APIs). mu-tools: shell/fs tools. mu-scheduler: cron. mu-local-provider: LLM (local-server-aware, used by mu-coding). mu-openai-provider: LLM (strict OpenAI). | Render UI; know what channel they run under. |
| **L3 — hosts** (`mu-coding`, future `arya`, future Telegram, …) | Glue L1 + L2 to a channel. | Wire protocol, persistence layout, channel-specific routing, host-specific slash commands. | Reimplement turn orchestration; re-derive state already in L2. |

## Module map (post-refactor)

```
mu-core/src/
├── activity.ts                    # ActivityBus (tool_start/end, agent_start/end, task_*)
├── agent.ts                       # runAgent loop
├── channel.ts                     # ChannelRegistry + Channel interface
├── hooks.ts                       # Hook composition primitives
├── ids.ts                         # newSessionId, newMessageId, nowMs
├── messageFactories.ts            # makeUser/Assistant/Tool/SyntheticMessage
├── messageMeta.ts                 # ChatMessageMeta (strict typing, no index sig)
├── plugin.ts                      # Plugin, PluginContext, hooks, MessageBus
├── projectMessage.ts              # ChatMessage → MessageDisplayRow
├── registry.ts                    # PluginRegistry
├── session.ts                     # SessionManager + onSessionCreated
├── ui.ts                          # UIService (optional TUI hook)
├── client.ts                      # Browser/RN-safe subset (excludes node:fs)
├── host/
│   ├── index.ts                   # startMu
│   └── runHostTurn.ts             # Canonical turn-from-text orchestrator
├── messageBus/
│   └── sessionScoped.ts           # createSessionScopedMessageBus + MessageBusRouter
├── sessionStore/
│   ├── jsonl.ts                   # JSONL on-disk store
│   ├── autoPersist.ts             # attachAutoPersist(session, store)
│   ├── grouping.ts                # groupByDate + formatRelativeTime
│   └── ...
├── provider/                      # Provider adapter + transport
└── utils/
    ├── duration.ts                # formatDuration
    ├── prettyArgs.ts              # prettyToolArgs
    ├── readMeta.ts                # typed meta accessors
    └── error.ts                   # enrichLLMError + errorMessage

mu-agents/src/
├── plugin.ts                      # Factory + activate/deactivate ONLY
├── hooks/agentHooks.ts            # buildHooks() — beforeLlm/decorate/transform/filter/beforeToolExec
├── dispatch/mention.ts            # @<subagent> dispatch + relay-prompt
├── ui/activateUI.ts               # Tab shortcut + @-mention provider + indicator
├── subagent.ts                    # runSubagent + emitHeader + finalize*
├── subagentTools.ts               # createSubagentTool + createSubagentParallelTool
├── subagentRun.ts                 # SubagentRunRegistry + SubAgentRunSnapshot
├── subAgentBus.ts                 # SubAgentBus + types (moved from mu-core)
├── approval.ts                    # ApprovalGateway + ApprovalSnapshot
├── manager.ts, sources.ts, markdown.ts, switchTracker.ts
├── permissions.ts, permissionGate.ts
├── messageTypes.ts                # AGENT_MESSAGE_TYPES constant
├── utils/displayName.ts           # capitalizeAgentName
└── handle.ts                      # MuAgentsHandle + typed accessors
```

## Plugin contract

```ts
interface Plugin {
  name: string;
  version?: string;
  tools?: PluginTool[];
  systemPrompt?: string | ((ctx) => string);
  hooks?: LifecycleHooks;
  commands?: SlashCommand[];
  agentLoop?: AgentLoopStrategy;
  activate?: (ctx: PluginContext) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
  [extra: string]: unknown;  // Plugins publish public handles here (e.g. mu-agents' manager/approvalGateway/runs)
}
```

## Wire surface (host responsibility)

Hosts define their wire. Recommended snapshot-oriented pattern (used by arya):

- `sub_agent_run` / `sub_agent_runs:listed` — `SubAgentRunSnapshot` from mu-agents
- `approval_state` / `approvals:listed` — `ApprovalSnapshot` from mu-agents
- `synthetic_message` — server-pre-filtered + author-enriched
- `stream` / `done` — per-turn streaming
- `sessions:*` — session CRUD + history

Clients are pure renderers — no client-side reducers.

## Plugin contract semantics

- Hooks compose **left-to-right**. Later plugins see prior plugins' output.
- `transformUserInput` outcomes:
  - `pass` — leave the text, build the user msg normally
  - `transform` — rewrite the user text
  - `intercept` — suppress the input entirely (host runs no turn)
  - `continue` — plugin appended its own msg + queued an `injectNext`; host runs a turn without a userMessage
- `ToolExecutor` returns `{ content, error? }` — plain-string returns no longer supported.

## `ChatMessageMeta` extension

Plugins that need custom meta keys extend via module augmentation:

```ts
declare module 'mu-core' {
  interface ChatMessageMeta {
    myPluginKey?: string;
  }
}
```

No index signature on `ChatMessageMeta` — typo'd keys fail compile.

## Migration history

| Batch | What landed |
|---|---|
| 1 | mu-core foundation: messageFactories, projectMessage, grouping, utils, strict ChatMessageMeta. |
| 2 | autoPersist middleware + onSessionCreated + author enrichment at wire. |
| 3 | Snapshot APIs on `SubagentRunRegistry` and `ApprovalGateway`. Channel hosts push snapshots, not raw events. |
| 4 | `runHostTurn` in mu-core. mu-agents split into 7 cohesive files. Ink renderer moved to mu-coding. SubAgentBus moved to mu-agents. |
| 5 | Session-scoped `MessageBus` (eliminates per-host router boilerplate). `ToolExecutor` strict (no string heuristic). |
