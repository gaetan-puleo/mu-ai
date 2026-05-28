# Multi-Agent Review — All Findings (Full Details)

Review covers: mu (core, tui, tools, local-provider, webfetch, coding-agent, harness) and arya-agent (arya server, arya-companion mobile).
54 sub-agents × 6 dimensions per package + 1 synthesis agent.

Format: each finding is numbered, with package, dimension, file:line, full description, impact, severity.

---

## PACKAGE: mu-core (`/home/gaetan-puleo/dev/mu/packages/core`)

### Bugs

**1. Tool-call loop guard leaves messages inconsistent — DONE**
- File: `src/runtime.ts:341-356`
- Dimension: Bug — Severity: P1
- Detail: `checkRepeatedToolCalls` throws BEFORE `executeToolCalls`, but `finalizeResponse` already pushed an assistant message with `tool_calls`. Session ends with `tool_calls` and no matching `tool` results.
- Impact: Most providers reject this on the next call — re-running the same session is broken.

**2. `start()`/`stop()` race leaks subscription — DONE**
- File: `src/runtime.ts:387,405`
- Dimension: Bug — Severity: P1
- Detail: `start()` awaits `callOnStart` before calling `bus.subscribe`. If `stop()` runs during that await, `stop` clears `unsubscribe = undefined`; then `start` resumes and assigns a new subscription that is never torn down.
- Impact: Listener stays subscribed past stop.

**3. Concurrent `start()` calls create duplicate subscriptions — DONE**
- File: `src/runtime.ts:387-401`
- Dimension: Bug — Severity: P2
- Detail: The `if (unsubscribe) return` guard at line 380 is checked before the await, so two parallel `start()` calls both proceed and subscribe twice.
- Impact: All events fire handlers twice.

**4. Stop during streaming still pushes partial assistant message — DONE**
- File: `src/runtime.ts:251-286`
- Dimension: Bug — Severity: P1
- Detail: When `stop()` flips state to `stopped` mid-stream, the `break` at 253 exits, but lines 284-286 still call `finalizeResponse({ content }, streamedCalls)` if anything was accumulated — pushing a half-message into `messages` and publishing `assistant_message` after stop.

**5. `Promise.all` over tool calls drops results on first failure — DONE**
- File: `src/runtime.ts:302-318`
- Dimension: Bug — Severity: P1
- Detail: If one `executeSingle` throws (e.g. unknown tool at 306), `Promise.all` rejects immediately; messages from already-completed tools are computed but never pushed/published.
- Impact: Side effects happened but transcript has no record; provider sees `tool_calls` with missing tool responses on retry.

**6. `assistant_start` with no matching finalize on empty/stop streams — DONE**
- File: `src/runtime.ts:241-286`
- Dimension: Bug — Severity: P2
- Detail: `assistant_start` is published before the loop unconditionally. If the stream yields nothing or everything is empty after stop, neither `assistant_message` nor any push happens.
- Impact: UI typing indicators leak.

**7. Wholly empty responses silently swallowed — DONE**
- File: `src/runtime.ts:217-239`
- Dimension: Bug — Severity: P2
- Detail: When `content === ''`, `toolCalls.length === 0`, and no reasoning, `finalizeResponse` pushes nothing and the loop falls through to `break`. User sees no response, no error, no continuation; queue idles.

**8. Side queues never drained on turn error — DONE**
- File: `src/runtime.ts:368` (finally block)
- Dimension: Bug — Severity: P1
- Detail: When the turn throws, the catch publishes error and the finally re-enters `processQueue`. `processQueue` shifts from the user `queue` (now empty), sets idle, returns — `steeringQueue`/`followUpQueue` accumulated during the failed turn sit dormant until the next user_message.

**9. `enqueueSide` shifts blindly — DONE**
- File: `src/runtime.ts:187-197`
- Dimension: Bug — Severity: P2
- Detail: `sideQueue.shift()` removes the head of the queue, not necessarily the message that was just pushed. If any prior message is still in the queue, the wrong message starts a turn.

**10. `tool.onError` can throw and abort the turn — DONE**
- File: `src/tools/callTool.ts:17-22`
- Dimension: Bug — Severity: P2
- Detail: `onError`'s return is not wrapped; if a plugin's `onError` throws, it bubbles out of `callTool` → `Promise.all` rejects → entire turn errors.
- Impact: Misbehaving plugin breaks the runtime instead of just losing one tool result.

**11. Shallow message copy in `create`/`fork` — DONE**
- File: `src/session.ts:74,101`
- Dimension: Bug — Severity: P2
- Detail: `[...init.messages]` and `source.messages.slice(...)` share message object references. If any consumer mutates `message.tool_calls` or `message.content` on either session, both reflect the change.

**12. Fork on empty source throws confusing range — DONE**
- File: `src/session.ts:90`
- Dimension: Bug — Severity: P2
- Detail: When `source.messages.length === 0`, the error reads `out of range (0..-1)`. Minor.

### Architecture

**13. `types/Tool.ts` is a junk drawer — DONE**
- File: `src/types/Tool.ts`
- Dimension: Architecture — Severity: P1
- Detail: Owns `Tool`, `ToolCall`, but also `LLMResponse`, `LLMStreamEvent`, `LLMResponseContext`, `ContextMap`, `ContextPart`. Provider-side response types do not belong in a file named `Tool.ts`.
- Fix: Split into `types/Tool.ts` (tool/call) and `types/LLM.ts` (response/stream/context); have `provider.ts` own response types.

**14. `tools/` folder name misleading — DONE**
- File: `src/tools/`
- Dimension: Architecture — Severity: P2
- Detail: Only `callTool` + `argUtils` live there — execution helpers — while the `Tool` type lives in `types/`. Either move helpers next to the type or rename to `executor/`.
- Fix: Moved `callTool.ts` + `argUtils.ts` up to `src/` and removed the empty `tools/` directory.

**15. Stale published artifacts contradict source — DONE**
- File: `npm/`, `dist/`
- Dimension: Architecture — Severity: P1
- Detail: `npm/` and `dist/` still export `defineProvider`; live `src/provider.ts` does not. `npm/package.json` is at v0.15.0 with a different description than `package.json` v0.16.0.
- Fix: `npm/` and `dist/` no longer exist; `defineProvider` shipped in `src/define.ts`.

**16. `provider.ts` re-exports types it doesn't own — DONE**
- File: `src/provider.ts`
- Dimension: Architecture — Severity: P1
- Detail: Pulls `Message`, `LLMResponse`, `LLMStreamEvent`, `Tools` and re-exports them. These same types are also exported from `index.ts` via `./types/Tool`. Two public paths to the same symbol.

**17. Runtime↔Session coupling is implicit — REJECTED**
- File: `src/runtime.ts:111-114`
- Dimension: Architecture — Severity: P2
- Detail: `createRuntime` mutates `session.messages` / `steeringQueue` / `followUpQueue` directly. `SessionStore` is essentially a passive data container while `Runtime` owns mutation — non-obvious split.
- Decision: Kept. Queues moved off Session entirely (#40); Runtime mutating `session.messages` is the documented contract. The host calls `store.touch(id)` on events when persistence is wanted — that split is explicit, not implicit.

**18. `bus.ts` `Unsubscribe` imported as type by `session.ts` — REJECTED**
- File: `src/session.ts`
- Dimension: Architecture — Severity: P2
- Detail: `Unsubscribe` could live in a `types/` file so `session.ts` doesn't have to reach into `bus.ts` just for a type alias.
- Decision: Kept. `Unsubscribe` belongs with `EventBus` — moving it to `types/` would create another import surface for a 1-line type. The import path is consistent with the conceptual home.

**19. Two hook surfaces in one runtime — REJECTED**
- File: `src/plugin.ts`, `src/runtime.ts`
- Dimension: Architecture — Severity: P2
- Detail: Plugin has lifecycle hooks (`onStart`/`onStop`/`onError`) but per-tool `ToolHooks` (`beforeTool`/`afterTool`) are passed via `RuntimeConfig.hooks` separately.
- Decision: Kept separate. `PluginHooks` are plugin lifecycle (per-plugin); `ToolHooks` are runtime-wide (gate every tool call). Merging would conflate cardinalities — a host wants one permission gate across all plugins, not one per plugin. Different purposes, different scopes.

**20. `index.ts` exports utilities mixed with runtime helpers — DONE**
- File: `src/index.ts`
- Dimension: Architecture — Severity: P2
- Detail: `formatError`, `parseArgs`, `callTool` exported alongside runtime factories. Consider a `tools` sub-export so non-runtime consumers don't pull the whole core.
- Fix: Exports now grouped by concern (Runtime, Plugin SDK, Bus, Sessions, Tool types, Message types, LLM types, Hooks, Helpers).

**21. `runtime.ts` is 435 lines mixing 6 concerns — REJECTED**
- File: `src/runtime.ts`
- Dimension: Architecture — Severity: P2
- Detail: Queue draining, provider resolution, stream consumption, finalization, lifecycle hooks, repeated-call detection. Good seams exist (`mergePluginTools`, `resolveProvider`, `processStream`, `executeToolCalls`).
- Decision: Kept as a single file. The "6 concerns" are one cohesive orchestration loop — splitting would force shared state (queues, currentState, turnAbort) through arguments or back-references, adding ceremony for no clarity. Internal seams already exist as functions.

### Responsibilities

**22. `defineProvider()` advertised but missing — DONE**
- File: AGENTS.md vs `src/provider.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: AGENTS.md (line 57) advertises `defineProvider()` as a core primitive, but `provider.ts` only exports the `ProviderFactory<Config>` type.
- Fix: Shipped `defineProvider` in `src/define.ts` and re-exported `ProviderFactory<TConfig>` from there.

**23. `defineTool()` / `definePlugin()` missing — DONE**
- File: `src/index.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: Standard SDK ergonomics for an advertised "Plugin SDK." Currently authors hand-roll `{ name, tools, hooks, provider }` objects.
- Fix: Shipped `defineTool`, `defineTools`, `definePlugin`, `defineProvider` helpers in `src/define.ts`.

**24. `createInMemorySessionStore` borderline scope — REJECTED**
- File: `src/session.ts:43-132`
- Dimension: Responsibilities — Severity: P2
- Detail: The interface belongs to core, but a concrete in-memory implementation with `idGen`/`now` overrides is host-flavored. Harness already ships `createJsonlSessionStore`.
- Decision: Kept in core. In-memory is the trivial reference impl that documents the contract; runtime tests rely on it; sub-agents use it for transient runs. Moving it would force tests and sub-agents to import harness.

**25. `package.json` description drift — DONE**
- File: `package.json`
- Dimension: Responsibilities — Severity: P2
- Detail: Description ("Agent runtime primitives: types, plugin SDK, runtime, sessions") accurate but repo context still says "hooks, event bus." Align.

### Types

**26. `Tool` not generic — DONE**
- File: `src/types/Tool.ts:1-8`
- Dimension: Types — Severity: P1
- Detail: `parameters: Record<string, unknown>` plus `execute: (args: string) => …` means tool authors can never get a typed `args` payload at compile time. Every tool re-parses JSON string and re-asserts shape.
- Fix: `interface Tool<TParams = unknown, TResult = string> { parameters: JSONSchema; execute(args: TParams): TResult | Promise<TResult> }`.

**27. `Tool.execute` returns string only — DONE**
- File: `src/types/Tool.ts:6`
- Dimension: Types — Severity: P1
- Detail: Returns `string | Promise<string>`. Forces every structured result to be re-serialized.
- Fix: `Tool<TArgs, TResult = string>` — each tool picks its own result shape; default `string` matches the wire format. `callTool` `JSON.stringify`s non-string results before they hit `ToolMessage.content`. No cross-package `ToolResult` union — each package is self-contained (see #43, #492).

**28. `Tools = Record<string, Tool>` erases names — DONE**
- File: `src/types/Tool.ts:10`
- Dimension: Types — Severity: P2
- Detail: No way for downstream packages to express "the tool map produced by this plugin contains `read` and `write`". A const-friendly helper would preserve literal keys.
- Fix: Added `defineTools<T extends Record<string, Tool>>(tools: T): T` — preserves the literal key set so `keyof` stays narrow.

**29. Escape hatches in public response shape — DONE**
- File: `src/types/Tool.ts:50-51`
- Dimension: Types — Severity: P2
- Detail: `timings?: Record<string, unknown>; raw?: Record<string, unknown>` are pure escape hatches.
- Fix: `LLMResponseContext` no longer has `timings`/`raw` — only `usage` and `contextMap`.

**30. `ToolCall.args: string` stringly-typed — DONE**
- File: `src/types/Tool.ts:12-17`
- Dimension: Types — Severity: P1
- Detail: Locks the entire pipeline into JSON-string passing.
- Fix: `ToolCall.args: string` matches what every provider emits (OpenAI/Anthropic/etc. serialize function arguments as JSON strings). The runtime calls `parseArgs(call.args)` once at the boundary so `Tool.execute(args: TArgs)` receives a typed payload. Wire stays string by provider contract; the pipeline is no longer locked.

**31. No `readonly` on Session identity fields — DONE**
- File: `src/types/Session.ts:8-18`
- Dimension: Types — Severity: P2
- Detail: `id`, `createdAt`, `forkedFrom` should be `readonly`.

**32. `Message` not a discriminated union by role — DONE**
- File: `src/types/Message.ts:3-8`
- Dimension: Types — Severity: P1
- Detail: `content: string` is required even for tool-result messages. Current shape lets you construct `{ role: 'user', tool_id: 'x' }`.

**33. `CoreEvent` error: unknown everywhere — DONE**
- File: `src/runtime.ts:13-27`
- Dimension: Types — Severity: P2
- Detail: `queue_update.steering`/`followUp` should be `readonly Message[]` to signal "snapshot, don't mutate".

**34. `as RuntimeState` casts — DONE**
- File: `src/runtime.ts:252, 348`
- Dimension: Types — Severity: P2
- Detail: Workaround for TS not re-widening a closure-captured `let`. Casts hide that compiler can no longer help.

**35. `EventBus<Event>` has no filtering primitive — DONE**
- File: `src/bus.ts:3-6`
- Dimension: Types — Severity: P1
- Detail: Every consumer takes `(event: Event) => void` and writes its own `if (event.type === …)` ladder. A typed `subscribe<K extends Event['type']>` overload would massively improve ergonomics.

**36. `Plugin` is non-generic — REJECTED**
- File: `src/plugin.ts:10-15`
- Dimension: Types — Severity: P2
- Detail: A plugin with a typed config loses its `Config` once wrapped.
- Decision: Kept non-generic. `Plugin` has no `config` field — the config is captured in closure via `defineProvider<TConfig>(factory)`. There's nothing to parameterize on the `Plugin` itself.

**37. `SessionStoreEvent` mixes session vs sessionId — DONE**
- File: `src/session.ts:5-8`
- Dimension: Types — Severity: P2
- Detail: `deleted` only carries `sessionId`, the others carry the full `Session`. Inconsistent.
- Fix: `deleted` now carries the full `Session` like the other variants. Harness `jsonl-store` updated to match.

**38. `Resolvable<T>` pattern duplicated — DONE**
- File: `src/types/Tool.ts:5`, `src/runtime.ts:49`
- Dimension: Types — Severity: P2
- Detail: 3-arm functor type `string | (() => string | undefined | Promise<string | undefined>)` duplicated verbatim.
- Fix: Extract `type Resolvable<T> = T | (() => T | Promise<T>)`.

**39. `parseArgs` returns Record without brand — REJECTED**
- File: `src/argUtils.ts:13`
- Dimension: Types — Severity: P2
- Detail: Cast unavoidable post-`JSON.parse`, but signature could return a `JsonObject` branded type.
- Decision: Kept. The runtime calls `parseArgs` exactly once at the boundary and passes typed `TArgs` to `Tool.execute` — brands would never escape that single call site. Net noise.

### Entities

**40. `Session` conflates persisted state + runtime queues — DONE**
- File: `src/types/Session.ts`
- Dimension: Entity — Severity: P1
- Detail: `steeringQueue` / `followUpQueue` are runtime-only working memory but live on the persisted entity. They round-trip through any serializer.
- Fix: Move to `Runtime` or `TurnState`.

**41. `Message` has no identity — DONE**
- File: `src/types/Message.ts`
- Dimension: Entity — Severity: P1
- Detail: No id, no timestamp, no provenance. Forking by `Session.forkedFrom.atIndex` is brittle.
- Fix: Every Message variant now extends a shared `MessageMetadata` with optional `id?: string` and `timestamp?: number`. The runtime never reads them — it round-trips whatever the host writes. Hosts that want fork-by-id, idempotent re-publishing, or telemetry can populate. Provenance lands at the event level via `MessageSource` (#315) so it stays close to the originating publish.

**42. `Message` role/payload union is implicit — DONE**
- File: `src/types/Message.ts`
- Dimension: Entity — Severity: P1
- Detail: `role: 'tool'` requires `tool_id`; `role: 'assistant'` may carry `tool_calls`. Discriminated union would eliminate optional-field soup.

**43. `ToolResult` not first-class — DONE (by design)**
- File: `src/types/Message.ts`, `src/types/Tool.ts`
- Dimension: Entity — Severity: P1
- Detail: Smuggled as `Message { role:'tool', content:string, tool_id }`. No place for `isError`, structured payload, latency, or originating ToolCall reference.
- Decision: Each package owns its own result encoding. The wire is `string` (matches every provider's serialization of tool results); tools that need structured output pick their own `TResult` via `Tool<TArgs, TResult>`. A cross-package `ToolResult` union would unify what's correctly self-contained. Per-tool `onError` already classifies failures; the `"Error: …"` prefix convention is the de-facto discriminator at the string level.

**44. `Tool.systemPrompt` phantom — REJECTED**
- File: `src/types/Tool.ts`, `src/runtime.ts:207`
- Dimension: Entity — Severity: P2
- Detail: Declared, explicitly unused in runtime.
- Decision: Kept. Not phantom — `Tool.systemPrompt` is consumed by the harness when composing the system prompt (`webfetch` defines one). Documented this on the type. The runtime deliberately skips auto-injection.

**45. `Plugin` is a bag — REJECTED**
- File: `src/plugin.ts`
- Dimension: Entity — Severity: P2
- Detail: Provider (exactly-one), tools (many), hooks (many) — very different cardinalities. `resolveProvider` enforces "exactly one" at runtime.
- Decision: Kept. Splitting into `ToolPlugin`/`ProviderPlugin`/`HooksPlugin` multiplies types and forces every install path to handle three variants. The runtime check is a single inline sanity assertion; conceptually a "plugin" is a single bundled extension.

**46. `RuntimeState` incomplete — REJECTED**
- File: `src/runtime.ts`
- Dimension: Entity — Severity: P2
- Detail: ('idle'|'running'|'stopped') doesn't capture errored/awaiting-tool.
- Decision: Kept 3-state. `state()` is consumed by hosts for UI gating (e.g. disable input while running) — they don't differentiate errored from idle (an error resets to idle automatically). Adding states forces every caller to handle them; current 3-state covers every observed use.

**47. `ContextPartKind` references concepts with no types — REJECTED**
- File: `src/types/Tool.ts:28-41`
- Dimension: Entity — Severity: P2
- Detail: Enumerates 'mcp' and 'skills' but mu-core has no MCP or Skills entities — leaked concerns from downstream.
- Decision: Kept. mu-local-provider actively buckets tools as 'mcp' or 'skills' based on naming heuristics for context-window accounting. The kinds are categorical labels at the bucket layer, not tied to entity types. Lives in `types/LLM.ts` now.

**48. `SessionInit` asymmetric with `Session` — DONE**
- File: `src/session.ts`
- Dimension: Entity — Severity: P2
- Detail: Accepts `messages` but no queues/timestamps; invites silent loss on reconstruction.
- Fix: `SessionInit` now also accepts optional `id`, `createdAt`, `updatedAt` so a persisted session can round-trip through `create()`. Queues moved off Session entirely (see #40), so there's nothing else to round-trip.

**49. Missing entities — REJECTED (most exist in the right package)**
- Dimension: Entity — Severity: P1
- Detail: Missing: `Turn` (the unit `processQueue` loops over), `ToolResult`, `Agent`, `Channel`, `Capability/Skill`, `ProviderConfig/ModelDescriptor`.
- Decision:
  - `Agent` — exists as `SubAgent` in harness.
  - `Channel` — exists in harness.
  - `Skill` — exists in harness.
  - `Model` / `LocalModel` — exist in harness/local-provider.
  - `Turn` — implicit in runtime; making it explicit would require persisting per-turn state nobody reads.
  - `ToolResult` — see #43 (deferred).
  - `ProviderConfig` — provider-specific; each provider owns its config shape.
  All host-level entities live in harness; only core primitives (Tool/Session/Message/etc.) belong in core.

### Simplifications

**50. `Runtime.session()` and `Runtime.queueState()` dead — DONE**
- File: `src/runtime.ts:33-34, 419-421, 431-433`
- Dimension: Simplification — Severity: P1
- Detail: Zero callers anywhere in the repo. Runtime already mutates session/queues in place.

**51. `ProviderFactory<Config>` dead export — DONE**
- File: `src/provider.ts:11`, `src/index.ts:3`
- Dimension: Simplification — Severity: P1
- Detail: Exported but no file imports it.

**52. `LLMResponseContext.timings/raw` dead — DONE**
- File: `src/types/Tool.ts:50-51`
- Dimension: Simplification — Severity: P1
- Detail: No producer sets them, no consumer reads them.

**53. `InMemorySessionStoreOptions` over-exposed — DONE**
- File: `src/session.ts:36-41`
- Dimension: Simplification — Severity: P2
- Detail: Only used by `session.test.ts`. Exporting interface for one test is over-engineering.

**54. `QueueMode='all'` branch dead — DONE**
- File: `src/runtime.ts:11, 51-52, 115-116, 154-158`
- Dimension: Simplification — Severity: P2
- Detail: Only ever defaulted to `'one-at-a-time'`. The `'all'` branch reachable only by tests.

**55. Standalone hook type aliases redundant — REJECTED**
- File: `src/types/Hook.ts:17-18`, `src/index.ts:23,26`
- Dimension: Simplification — Severity: P2
- Detail: `BeforeToolHook` / `AfterToolHook` aliases redundant with `ToolHooks` shape.
- Decision: Kept. Aliases are actively imported by harness (`permissions/hook.ts`, `sub-agents/runner.ts`) — `BeforeToolHook` as a named return type is much more readable than the inline function signature.

**56. `consumeResult` IIFE-generator wrap — DONE**
- File: `src/runtime.ts:293-300`
- Dimension: Simplification — Severity: P2
- Detail: Wraps non-stream result in a `done`-only async generator. Handle inline; avoids 5-line wrapper + `isAsyncIterable` predicate.

**57. `seenCallIds` reconciliation dead defensive code — REJECTED**
- File: `src/runtime.ts:262-273`
- Dimension: Simplification — Severity: P2
- Detail: Local-provider only does one or the other per turn.
- Decision: Kept. Other providers (Anthropic, OpenAI) may legitimately emit tool calls via both streaming events AND `done.response.tool_calls`. Defensive dedup is cheap; removing it would break those providers.

**58. Inlinable helpers — DONE**
- File: `src/runtime.ts:302-311, 182-185, 144-151, 134-142`
- Dimension: Simplification — Severity: P2
- Detail: `executeSingle`, `startTurn`, `callLifecycleHook`, `callOnError` all inlinable.

**59. Duplicate re-exports in `provider.ts` — DONE**
- File: `src/provider.ts:4-5`
- Dimension: Simplification — Severity: P1
- Detail: Re-exports `Message`, `LLMResponse`, etc. that index.ts already re-exports.

---

## PACKAGE: mu-tui (`/home/gaetan-puleo/dev/mu/packages/tui`)

### Bugs

**60. Paste overflow desync — DONE**
- File: `src/parser.ts:30-35`
- Dimension: Bug — Severity: P1
- Detail: On paste overflow, sets `inPaste = false` and clears `paste`, but trailing paste content + `\x1b[201~` (PASTE_END) remain in subsequent input chunks. Those bytes are then re-parsed as regular key/CSI input.
- Impact: Large paste corrupts the input stream; may trigger keystrokes embedded in pasted text.

**61. SIGHUP not handled — DONE**
- File: `src/terminal.ts:159-177`
- Dimension: Bug — Severity: P1
- Detail: Only `SIGINT`, `SIGTERM`, `exit` are wired for cleanup. On terminal disconnect (closing tab/SSH drop), raw mode, alternate screen, mouse modes etc. are NOT restored.
- Impact: User's shell broken until manual `reset`.

**62. Escape-timeout timer race — DONE**
- File: `src/tui.ts:387-392, 379`
- Dimension: Bug — Severity: P2
- Detail: Every new input chunk clears the prior pending-escape timer unconditionally. If a CSI sequence arrives split across chunks larger than `escapeTimeoutMs`, the timer keeps getting cancelled and may never fire.

**63. Listener iteration mutation during dispatch — DONE**
- File: `src/tui.ts:418-424`
- Dimension: Bug — Severity: P2
- Detail: `for (const listener of this.inputListeners)` directly over live array. If a listener removes itself or another mid-dispatch (common pattern with `off()`), the next listener can be skipped.

**64. Dead `0xffff` check — DONE**
- File: `src/parser.ts:117`
- Dimension: Bug — Severity: P2
- Detail: `first > 0xffff ? 2 : 1` — control bytes can never be > 0xffff. Dead branch. Harmless but indicates confused intent.

**65. `SelectList.moveSelection` with all disabled — DONE**
- File: `src/components/SelectList.ts:213-222`
- Dimension: Bug — Severity: P2
- Detail: Iterates `len` times and ends back at original index. Behavior depends on clamping.

**66. `ScrollView.InnerContainer.measure` ignores constraints — DONE**
- File: `src/components/ScrollView.ts:195-200`
- Dimension: Bug — Severity: P2
- Detail: Returns `{ width: 0, height: this.measureNaturalHeight() }` with infinite maxWidth. Children may report height-for-infinite-width that doesn't match actual wrap.
- Impact: Incorrect scroll bounds when inner children wrap text.

**67. Hardcoded debug keychord — DONE (`onDebug` removed; no consumers)**
- File: `src/tui.ts:447`
- Dimension: Bug — Severity: P2
- Detail: `'\x1b[22;32u'` is terminal-specific. Other terminals won't produce this exact byte sequence.

**68. `Diff` type narrowing loses `gap` variant — DONE**
- File: `src/components/Diff.ts:320-321`
- Dimension: Bug — Severity: P2
- Detail: `applyContext` types `parts: DiffPart[]` but returns `Array<DiffPart | { type: 'gap' }>`. Type system can't enforce.

### Architecture

**69. `tui.ts` is 750-line god-object — DONE**
- File: `src/tui.ts`
- Dimension: Architecture — Severity: P1
- Detail: Mixes ≥7 concerns: lifecycle, render scheduling/throttling, diff algorithm, layout invocation, input router, focus traversal, feature lifecycle, global keybindings.
- Fix: Split into `renderer`, `inputRouter`, `featureHost`, `focusManager`.

**70. Legacy `canvas.ts` coexists with `cellbuffer.ts` — DONE**
- File: `src/layout/canvas.ts`
- Dimension: Architecture — Severity: P1
- Detail: `tui.ts` uses `cellbuffer.ts`; `canvas.ts` isn't imported anywhere outside its own tests — dead path that doubles the "what's the renderer" question.
- Fix: `canvas.ts` and its test are gone — cellbuffer is the single renderer.

**71. `Container` interface dead — DONE**
- File: `src/types/component.ts:63`
- Dimension: Architecture — Severity: P2
- Detail: `TUI.addChild` etc. duplicates it. Comment admits "kept for backward compatibility"; nothing implements it.

**72. `Box.measure()` duplicates layout-engine logic — REJECTED**
- File: `src/components/Box.ts:32-59`
- Dimension: Architecture — Severity: P2
- Detail: Re-implements row/column main-axis summing — layout responsibility leaks into a component.
- Decision: Kept. `Box.measure()` answers "intrinsic size given these children" — that requires knowing the children's stacking. Pushing it into the engine would mean every container expresses its measurement strategy as data; the function form is simpler.

**73. Composition rules unmodeled — REJECTED**
- File: `src/components/Modal.ts:5`
- Dimension: Architecture — Severity: P2
- Detail: `Modal` imports `Box` but most other components don't compose. Component-to-component coupling unmodeled.
- Decision: Kept. Modal composes Box internally as an implementation detail (panel + body slot) — not a public composition contract. A formal "composition rules" type would only document what's already obvious from each constructor's signature.

**74. No barrel for `layout/` or `features/` — REJECTED**
- File: `src/index.ts`, `package.json`
- Dimension: Architecture — Severity: P2
- Detail: Hand-picks types from `./layout/types` and feature symbols aren't re-exported. Tests/consumers must use deep paths.
- Decision: `features/` is gone entirely. `layout/` is internal — its primitives (engine, hitTest, render, cellbuffer) shouldn't be public API; only the small subset of types (Rect, Color, Constraints, etc.) is re-exported via `index.ts`. Adding a `./layout` barrel would surface internals consumers shouldn't reach for.

**75. `feature.ts` location inconsistent — DONE**
- File: `src/feature.ts`
- Dimension: Architecture — Severity: P2
- Detail: Lives at root, but `features/` is a sibling folder. Natural location would be `features/types.ts` or `features/index.ts`.
- Fix: `feature.ts` and the entire `features/` directory are gone (#108).

**76. Mouse-event target uses linear search — DONE**
- File: `src/tui.ts:343-352`
- Dimension: Architecture — Severity: P2
- Detail: Walks `parent` via `find()` on every event — N² over entry list.
- Fix: `InputRouter.findMouseEventTarget` now takes a precomputed `Map<Component, LayoutEntry>` (`byComponent`) — O(N + depth) instead of O(N × depth).

**77. `LAYOUT_PLAN.md` Phase 18 unimplemented — DONE**
- File: `LAYOUT_PLAN.md`, `package.json`
- Dimension: Architecture — Severity: P1
- Detail: Prescribes `./components`, `./layout`, `./features` exports. `package.json` exposes only `.` and `./components`.
- Fix: `LAYOUT_PLAN.md` was deleted (#123). `./features` is moot — features/ removed entirely. Current `.` and `./components` exports match the actual shipped API.

**78. `README.md` + `CONTEXT.md` severely stale — DONE**
- File: `README.md`, `CONTEXT.md`
- Dimension: Architecture — Severity: P1
- Detail: Describe the package as a flat 8-file, 1158-LOC "render engine, not a widget library" with no components folder. Reality: 8836 LOC, 9 components shipped, full layout engine.

**79. `focusScope` unimplemented — DONE**
- File: `src/tui.ts:175-181`, `LAYOUT_PLAN.md`
- Dimension: Architecture — Severity: P2
- Detail: Phase 11 says focus scopes should use `scope?: Component`. Current `getFocusableComponents()` ignores `focusScope` entirely.
- Fix: `focusScope` plumbing removed; `FocusManager` is the focus owner now.

### Responsibilities

**80. Cleanest separation in monorepo — INFO (positive observation, no action)**
- File: `package.json`, `src/`
- Dimension: Responsibilities — Severity: (info)
- Detail: Zero mu coupling, zero workspace deps. No imports from any other mu-* package.

**81. Package README is the repo README — DONE**
- File: `packages/tui/README.md`
- Dimension: Responsibilities — Severity: P1
- Detail: Not package-specific. Should state generic engine boundary explicitly.

**82. `CONTEXT.md` stale — DONE**
- File: `packages/tui/CONTEXT.md`
- Dimension: Responsibilities — Severity: P1
- Detail: Rich and correct in intent but internal and severely outdated.

**83. Doc-comment reference to ChatApp — DONE**
- File: `src/components/SelectList.ts:34, 49`
- Dimension: Responsibilities — Severity: P2
- Detail: Mentions "coding-agent ChatApp model picker" as integration example — harmless wording, not coupling, but worth removing.

**84. `feature` naming collides with mu-core plugin concept — DONE**
- File: `src/feature.ts`, `src/features/`
- Dimension: Responsibilities — Severity: P2
- Detail: Confusing to newcomers. Rename to `terminalFeature` / `terminalFeatures` or `caps`.

### Types

**85. Duplicate mouse types — DONE**
- File: `src/types/mouse.ts:1-16`, `src/events.ts:25-45`
- Dimension: Types — Severity: P1
- Detail: Two public mouse vocabularies for one concept. `MouseEvent` and `MouseButton` clash with `MouseInputEvent` / different `MouseButton` shapes (`wheelUp` vs `scrollUp`).
- Fix: `types/mouse.ts` was removed (#112); `events.ts` is now the single source for mouse types.

**86. Cast in keybinds — DONE**
- File: `src/keybinds.ts:23`
- Dimension: Types — Severity: P1
- Detail: `as unknown as Record<string, boolean | undefined>` cast. Should be `(event as KeyInputEvent)[field]`.
- Fix: Replaced cast with explicit field-by-field comparison after the `event.type !== 'key'` guard. No casts.

**87. `userContext: unknown` everywhere — DONE (TUI side)**
- File: `src/layout/types.ts:165,178`, `src/tui.ts:43,78,112,117`
- Dimension: Types — Severity: P1
- Detail: A class-level generic `TUI<TContext = unknown>` would give consumers type-safe access to their theme/provider blob without casts.
- Fix: `TUI<TContext = unknown>` is now generic; `TuiOptions<TContext>`, `setUserContext`, `getUserContext` carry the typed payload. `RenderContext.userContext` / `EventContext.userContext` stay `unknown` since components must remain reusable across host context types.

**88. `Focusable` structural-only — REJECTED**
- File: `src/types/component.ts:48`
- Dimension: Types — Severity: P2
- Detail: `focused: boolean` is the sole discriminant. Any component with an unrelated `focused` field will be treated as focusable.
- Decision: Kept structural. Branding would force every focusable component to add a marker symbol — net noise for a discriminant that has never collided in practice (no other component has a `focused: boolean` field).

**89. `Container` legacy + unparameterized — DONE**
- File: `src/types/component.ts:63-70`
- Dimension: Types — Severity: P2
- Detail: `addChild`/`removeChild` take `Component` but no type narrowing.

**90. Layout primitives lack `readonly` — DONE**
- File: `src/layout/types.ts:5-32`
- Dimension: Types — Severity: P2
- Detail: `Rect`/`Size`/`Insets`/`Constraints` flow through `LayoutEntry`/`RenderContext`. Marking fields `readonly` would prevent consumer mutation of engine output.

**91. `margin: number | Partial<Insets>` allows `{}` — REJECTED**
- File: `src/layout/types.ts:120,122`
- Dimension: Types — Severity: P2
- Detail: `Partial<Insets>` allows empty object, which is meaningless.
- Decision: Kept. `{}` reads as "no margin specified" — a valid intent for a partial override. Fixing it to "at least one field" would require a complex helper type for no real safety win.

**92. `StartableTerminal` cast bypasses contract — DONE**
- File: `src/tui.ts:26-29, 218, 244`
- Dimension: Types — Severity: P2
- Detail: `this.terminal as StartableTerminal` bypasses public Terminal contract.
- Fix: `start?`/`stop?` are now first-class optional members of the public `Terminal` interface; the private `StartableTerminal` alias + casts are gone.

**93. Inline `capabilities` shape cast — DONE**
- File: `src/tui.ts:94`
- Dimension: Types — Severity: P2
- Detail: `(terminal as { capabilities?: Capabilities })` ad-hoc.
- Fix: `Terminal.capabilities?` is now a first-class optional member; the cast is gone.

**94. `Component.render` returns mutable array — DONE**
- File: `src/types/component.ts:23`
- Dimension: Types — Severity: P2
- Detail: `string[]` should be `ReadonlyArray<string>`. `render.ts:67` does defensive `slice`.

**95. `Capabilities` fully mutable — DONE**
- File: `src/capabilities.ts:78-87`
- Dimension: Types — Severity: P2
- Detail: `TUI.getCapabilities()` hands the live reference back.

**96. `GlobalKeybinding.handler: () => void` — DONE**
- File: `src/keybinds.ts:11-15`
- Dimension: Types — Severity: P2
- Detail: No event parameter. Unusually narrow vs rich `InputEvent` surface.
- Fix: `handler: (event: KeyInputEvent) => void` — the dispatcher now passes the matched event.

### Entities

**97. `Component` is a god interface — REJECTED**
- File: `src/types/component.ts:12`
- Dimension: Entity — Severity: P1
- Detail: 9 optional members spanning layout, render, events, measure, layout mutation (`prepareLayout`), key-release opt-in, `invalidate`. No clean split between leaf and container.
- Decision: Kept as a single interface with optional members. Splitting into leaf/container/focusable/etc. variants forces every consumer to handle the union ("is this `Container` or `Leaf`?") — current shape lets components opt into capabilities by adding fields, and the layout engine treats them uniformly.

**98. `Container` is dead weight — DONE**
- File: `src/types/component.ts:59`
- Dimension: Entity — Severity: P1
- Detail: Comment admits kept for "backward compat"; `Box` re-implements add/remove and ignores it.
- Fix: `Container` interface was removed (#71, #89, #113).

**99. Style is split 3 ways — REJECTED**
- File: `src/layout/types.ts`, `src/layout/cell.ts`
- Dimension: Entity — Severity: P1
- Detail: `LayoutStyle` holds visual attrs (bg, border, opacity) alongside layout; `CellStyle` holds glyph-level visual attrs; raw SGR escape strings are passed as `panelStyle`/`titleStyle` props. Three uncoordinated style entities.
- Decision: Kept the three because they sit at different layers: `LayoutStyle` is per-component (used by layout engine), `CellStyle` is per-cell (used by renderer), SGR strings let callers pass already-built escape sequences (cheaper than re-coalescing on every frame). Unifying would either bloat each layer's API or force conversions on the hot path.

**100. No `Theme` entity — REJECTED (lives in agent layer)**
- File: `src/layout/types.ts:163`
- Dimension: Entity — Severity: P1
- Detail: Themed colors leak through `userContext: unknown` and ad-hoc raw SGR string props. SelectList's comments explicitly admit this gap.
- Decision: Theme is an agent-layer concept (coding-agent ships `ThemeProvider` / `darkTheme` / `lightTheme`), not a mu-tui primitive. Different agents will want different theme shapes; baking one into mu-tui would force them into a single vocabulary. The `userContext` channel with `TUI<TContext>` (#87) is the typed seam.

**101. No named `FocusManager`/`FocusScope` — DONE**
- File: `src/tui.ts`
- Dimension: Entity — Severity: P2
- Detail: Focus state sprinkled across TUI, Focusable, focusScope flag.
- Fix: `FocusManager` is now its own class in `src/focusManager.ts`; `TUI` delegates focus traversal to it. `focusScope` is gone (#79).

**102. No `Cursor` entity — REJECTED**
- File: `src/tui.ts`
- Dimension: Entity — Severity: P2
- Detail: Cursor row/positioning lives as ad-hoc TUI fields.
- Decision: Kept. Cursor is two small fields (visible y/x) consumed only by the renderer; a dedicated entity would add a class for two booleans + coordinates.

**103. No `EventRouter` — DONE**
- File: `src/tui.ts`
- Dimension: Entity — Severity: P2
- Detail: Routing logic inline in `tui.ts`, not a named entity.
- Fix: `InputRouter` is now its own class in `src/inputRouter.ts`; `TUI` delegates input dispatch to it.

**104. `EventContext` duplicates `RenderContext` — REJECTED**
- File: `src/layout/types.ts:151,169`
- Dimension: Entity — Severity: P2
- Detail: Should share a base or extend.
- Decision: Kept. They overlap on `rect`/`contentRect`/`focused`/`userContext` but diverge meaningfully: `EventContext` adds `localX`/`localY` (mouse-only), `RenderContext` doesn't. A shared base would force a 2-line inheritance chain for two short interfaces.

### Simplifications

**105. `layout/canvas.ts` dead — DONE**
- File: `src/layout/canvas.ts:1-248`, `src/layout/canvas.test.ts`
- Dimension: Simplification — Severity: P1
- Detail: File is `@deprecated` (line 6), only consumed by its own test.

**106. `protocol.ts` zero callers — DONE**
- File: `src/protocol.ts:1-69`
- Dimension: Simplification — Severity: P1
- Detail: `detectTerminalProtocolSync`, `supportsProtocol`, `TerminalProtocol`, `ProtocolResult` have zero callers. OSC/CSI constants only used by `features/*.ts` (also dead).

**107. Entire `features/` directory dead — DONE**
- File: `src/features/`
- Dimension: Simplification — Severity: P1
- Detail: `clipboard.ts`, `shellIntegration.ts`, `terminfo.ts`, `images.ts` — no consumer ever passes them via `TuiOptions.features`.

**108. `feature.ts` infrastructure dead — DONE**
- File: `src/feature.ts`, `src/tui.ts:32-33,73-76,705-739`
- Dimension: Simplification — Severity: P1
- Detail: `TuiFeature`, `FeatureContext`, `RuntimeEnv`, `createRuntimeEnv`, `TUI.features`, `setupFeatures`, `cleanupFeatures`, etc. No registrations exist.

**109. `drain.ts` collapsible — DONE**
- File: `src/drain.ts`
- Dimension: Simplification — Severity: P2
- Detail: Only one caller, inside the same package. Collapse into `terminal.ts`.

**110. `probeKittyKeyboard` unused externally — DONE**
- File: `src/keyboard.ts:371-406`
- Dimension: Simplification — Severity: P2
- Detail: Exported but never used externally; capability detection in `capabilities.ts` already infers Kitty.

**111. `eventToMouseEvent` zero callers — DONE**
- File: `src/keyboard.ts:81-100`
- Dimension: Simplification — Severity: P2
- Detail: Converts `MouseInputEvent` to a parallel `MouseEvent` type.

**112. `types/mouse.ts` parallel dead system — DONE**
- File: `src/types/mouse.ts:1-16`
- Dimension: Simplification — Severity: P1
- Detail: `MouseButton`, `MouseMotion`, `MouseEvent` — duplicating `events.ts` `MouseInputEvent`. No external consumer.

**113. `FocusableNavigation`, `Container`, `isFocusableNavigation` dead — DONE**
- File: `src/types/component.ts:53-70`, `src/types/guards.ts:7-9`, `src/tui.ts:191-199`
- Dimension: Simplification — Severity: P1
- Detail: Container explicitly "kept for backward compatibility"; FocusableNavigation has no implementer.

**114. Components Button, Diff, Spacer unused — DONE**
- File: `src/components/`
- Dimension: Simplification — Severity: P1
- Detail: Not imported by any consumer (verified across repo).

**115. Confirm-chord logic dead — DONE**
- File: `src/keybinds.ts`, `src/tui.ts:71,464-485`
- Dimension: Simplification — Severity: P2
- Detail: `confirm: true` is never set; only plain handlers registered.

**116. `hasPendingEscape` unused — DONE**
- File: `src/parser.ts:82-84`
- Dimension: Simplification — Severity: P2
- Detail: No callers.

**117. Most `TUI` API never called externally — DONE**
- File: `src/tui.ts:81,99-101,103-105,117-119,133-135,166-168,175-181,277-283,293-299,301-305,308-311,313-316`
- Dimension: Simplification — Severity: P1
- Detail: `getCapabilities`, `updateCapabilities`, `getUserContext`, `getBackgroundColor`, `addRawInputListener`, `addInputListener`, `getFocusableComponents`, `layoutSnapshot`, `getLayoutEntries`, `invalidate`, `onDebug` — all unused.

**118. Many `TuiOptions` knobs never varied — DONE**
- File: `src/tui.ts`
- Dimension: Simplification — Severity: P2
- Detail: `synchronizedOutput`, `escapeTimeoutMs`, `maxInputBufferBytes`, `maxPasteBytes`, etc. — all defaults.

**119. `Text.setWrap()` unused — DONE**
- File: `src/components/Text.ts:38-40`
- Dimension: Simplification — Severity: P2
- Detail: No callers.

**120. `sliceByColumn`, `stripAnsi` only used by dead canvas — DONE**
- File: `src/utils.ts`
- Dimension: Simplification — Severity: P2
- Detail: Drop from `index.ts` exports if canvas goes.

**121. Many capability flags always false — DONE**
- File: `src/capabilities.ts`
- Dimension: Simplification — Severity: P2
- Detail: `screen.synchronizedOutput`, `screen.cursorShape`, `colors.underlineColor`, `input.csiU`, `mouse.motion`, `mouse.pixel`, `graphics.sixel`, `osc.clipboard` — nothing flips them.

**122. `expandRect`, `hitTestRect` only used by own tests — DONE**
- File: `src/layout/insets.ts:43-50`, `src/layout/hitTest.ts:36-49`
- Dimension: Simplification — Severity: P2

**123. `LAYOUT_PLAN.md`, `CONTEXT.md` stale planning docs — DONE**
- File: package root
- Dimension: Simplification — Severity: P2
- Detail: 16KB + 10KB. Should be deleted or completely rewritten.

**124. `npm/` directory committed — DONE**
- File: `packages/tui/npm/`, `packages/coding-agent/npm/script/coding-agent/npm/src/tui/...`
- Dimension: Simplification — Severity: P2
- Detail: Generated artifacts shouldn't be committed; duplicated tree.

---

## PACKAGE: mu-tools (`/home/gaetan-puleo/dev/mu/packages/tools`)

### Bugs

**125. `restrictToCwd` bypassable via symlinks — DONE**
- File: `src/utils.ts:27`
- Dimension: Bug — Severity: P1
- Detail: Containment check uses `path.resolve` only, not `fs.realpathSync`. A symlink at `<cwd>/link -> /etc` resolves to `<cwd>/link` which passes prefix test, and subsequent `readFileSync` / `writeFileSync` follows the symlink.
- Impact: Sandbox escape for read/write/edit/list_dir.

**126. Prefix check platform-fragile — DONE**
- File: `src/utils.ts:27`
- Dimension: Bug — Severity: P2
- Detail: Only matches `${normalizedCwd}/` (POSIX `/`). On Windows the check never triggers.

**127. Unbounded read into memory — DONE**
- File: `src/read-file.ts:25`
- Dimension: Bug — Severity: P1
- Detail: `readFileSync(path, 'utf-8')` then `.split('\n')` on entire file regardless of `start`/`end`. Reading a 5 GB log to print "lines 1-10" OOMs the host.

**128. Binary/non-UTF-8 corruption — DONE**
- File: `src/read-file.ts:25`, `src/edit-file.ts:44`, `src/write-file.ts:38`
- Dimension: Bug — Severity: P1
- Detail: Forcing `'utf-8'` decode on binary files silently replaces invalid bytes with U+FFFD, then `writeFileSync(..., 'utf-8')` (edit) persists the corrupted version, destroying the original. UTF-8 BOM also preserved and re-emitted.

**129. Read/modify/write race (edit) — DONE**
- File: `src/edit-file.ts:43-52`
- Dimension: Bug — Severity: P2
- Detail: TOCTOU between `readFileSync` and `writeFileSync`. Another writer can change the file; edit overwrites concurrent changes with no detection. Crash mid-`writeFileSync` leaves partial file (no atomic temp+rename).

**130. Non-atomic write — DONE**
- File: `src/write-file.ts:38`
- Dimension: Bug — Severity: P2
- Detail: Plain `writeFileSync` truncates first; crash mid-write leaves zero/partial file.

**131. `bash` no abort wiring + detached without unref — DONE**
- File: `src/bash.ts:9-12`
- Dimension: Bug — Severity: P1
- Detail: `detached: true` without `proc.unref()`. AbortSignal from runtime is ignored entirely — no signal parameter; a model-cancelled tool call still runs to completion or 120s timeout.

**132. `bash` unbounded stdout/stderr OOM — DONE**
- File: `src/bash.ts:30-35`
- Dimension: Bug — Severity: P1
- Detail: A command like `yes` accumulates gigabytes of `stdout` in JS strings until OOM or 120s timeout. No max-buffer guard.

**133. `bash` resolve race — DONE**
- File: `src/bash.ts:37`
- Dimension: Bug — Severity: P2
- Detail: Promise resolves on `close`. If `proc.on('error')` fires after, `clearTimeout` runs twice; if SIGKILL is blocked by D-state child, promise never resolves.

**134. `bash` bypasses `restrictToCwd` contract — DONE**
- File: `src/bash.ts`, `src/index.ts`
- Dimension: Bug — Severity: P1
- Detail: Documented as "run a shell command," but `cmd` passed to `bash -c` verbatim with no allow/deny list. A sandboxed agent that thinks paths are constrained can still `bash -c 'cat /etc/shadow'`.

**135. `list_dir` throws on permission-denied subdirs — DONE**
- File: `src/list-dir.ts:12`
- Dimension: Bug — Severity: P2
- Detail: `listDirRecursive` calls itself without try/catch around `readdirSync`. A single unreadable subdir aborts entire listing.

**136. No cycle/symlink-loop protection — DONE**
- File: `src/list-dir.ts:11`
- Dimension: Bug — Severity: P2
- Detail: Recursive listing follows directory symlinks via `statSync` (not `lstatSync`). Symlink loop causes infinite recursion until stack overflow.

**137. Wasteful split+replace — DONE**
- File: `src/edit-file.ts:45`
- Dimension: Bug — Severity: P2
- Detail: `content.split(oldString).length - 1` materializes N+1 substrings. Correctness OK; perf only.

**138. `getCwd()` not validated — DONE**
- File: All tools
- Dimension: Bug — Severity: P2
- Detail: If `getCwd()` returns a non-existent path, `spawn` rejects with `ENOENT` but `existsSync` checks don't validate cwd itself.

### Architecture

**139. Clean one-file-per-tool — INFO (positive observation, no action)**
- File: `src/`
- Dimension: Architecture — Severity: (info)
- Detail: Each tool file is self-contained: imports `Tool` type, the two arg helpers, and (for fs tools) `sanitizePath`. No cross-tool imports.

**140. `sanitizePath` earns its place — INFO (positive observation, no action)**
- File: `src/utils.ts:17`
- Dimension: Architecture — Severity: (info)
- Detail: Used by 4/5 tools with identical semantics (quote stripping, cwd resolution, optional containment).

**141. Mild per-tool error-shaping duplication — DONE (largely)**
- File: `src/read-file.ts:17-25`, etc.
- Dimension: Architecture — Severity: P2
- Detail: Each fs tool repeats `sanitizePath → null check → existsSync → try/catch → formatError` shape.
- Fix: `sanitizePath` now always returns a string (no null branch — see #166); `formatError` is shared via `Tool.onError`. Each fs tool is down to a small `existsSync + try/catch + formatError`; further extraction would create a single-call helper that's not reused, net negative readability.

**142. Permission `matchKey` missing — REJECTED (lives in harness)**
- File: `packages/core/src/types/Tool.ts:1-8`
- Dimension: Architecture — Severity: P1
- Detail: Repo brief says each tool needs a "permission `matchKey`", but `Tool` has only `name/description/parameters/execute/onError/systemPrompt`. No tool here exports a permission descriptor.
- Decision: Permissions live in harness (`packages/harness/src/permissions/`) — `PermissionRule` matches by `toolName + argsPattern` (glob over stringified args). Adding `matchKey` to Tool in core would couple core to a permission concept it has no opinion on. The harness's glob-based matching is the canonical mechanism.

**143. `bash` is the outlier — REJECTED (containment is host's job)**
- File: `src/bash.ts`
- Dimension: Architecture — Severity: P1
- Detail: No `sanitizePath`, no `restrictToCwd`, hard-coded 120s timeout, no `cwd` validation. `restrictToCwd` is a half-promise — paths constrained, but `bash` can `cd ..` freely.
- Decision: `restrictToCwd` is gone (#166) so the asymmetry is moot. Containment for arbitrary shell is the host's job via permission rules (`PermissionRule { tool: 'bash', argsPattern }`). `bash` correctly stays general-purpose; trying to sandbox arbitrary shell at the tool layer would be theatre.

**144. `getCwd` injection good design — INFO (positive observation, no action)**
- File: All factories
- Dimension: Architecture — Severity: (info)
- Detail: Lets host swap working directory per session without restarting tools.

### Responsibilities

**145. Coherent fs+shell bundle — INFO (positive observation, no action)**
- File: `src/`
- Dimension: Responsibilities — Severity: (info)
- Detail: Five tools share single organizing concept: "things an agent does to host's local environment, sandboxed to one cwd." Don't split.

**146. `formatError`/`parseArgs` re-export blurs ownership — DONE**
- File: `src/utils.ts:3`
- Dimension: Responsibilities — Severity: P2
- Detail: Re-exports from `mu-core`. Could drop re-export and have call sites import directly.

**147. `sanitizePath` could hoist if needed — REJECTED (not yet)**
- File: `src/utils.ts`
- Dimension: Responsibilities — Severity: P2
- Detail: Only genuinely shareable helper. Hoist to mu-core if a 2nd tools package ever needs it.
- Decision: Leave it in mu-tools. No other package needs it today; hoisting now would over-generalize for a single consumer. Move it the day a second consumer appears.

### Types

**148. Per-tool `as T` casts without runtime guards — DONE**
- File: `src/read-file.ts:62-67`, `src/edit-file.ts:32-38`, `src/write-file.ts:27-32`, `src/list-dir.ts:56-70`, `src/bash.ts:81`
- Dimension: Types — Severity: P1
- Detail: `parsed.x as T` everywhere. Each tool re-asserts schema invariants in TS without runtime check.

**149. `bash` no runtime guard on `cmd` — DONE**
- File: `src/bash.ts:81`
- Dimension: Types — Severity: P1
- Detail: `parsed.cmd as string`. If LLM sends `{ cmd: 123 }`, cast silently lies and downstream `spawn` coerces.

**150. JSON schemas inline + untyped — DONE**
- File: All factories
- Dimension: Types — Severity: P1
- Detail: `parameters: Record<string, unknown>` from core. Schema authors get zero IDE feedback; typos like `type: 'intger'` compile.
- Fix: Each package owns its tool schemas inline — no central JSON-Schema validator. `Tool.execute` is typed via `<TArgs>` so authors get IDE feedback on the consumer side; schema typos are caught when an LLM actually fails to call the tool. Adding a JSON-Schema validator type would force a shared dependency on a schema library across every package — net cost > benefit (see #492).

**151. Result type is `string` everywhere — DONE (by design)**
- File: All factories
- Dimension: Types — Severity: P1
- Detail: Errors encoded as `"Error: ..."` strings. No discriminated union `{ ok: true; data } | { ok: false; error }`.
- Decision: Self-contained packages, see #43. The wire is `string` by provider contract; each tool picks its `TResult` if it needs structured output. No cross-package union.

**152. `restrictToCwd: boolean` single flag — DONE (removed)**
- File: `src/index.ts:24`
- Dimension: Types — Severity: P2
- Detail: No allowlist, no per-tool override, no glob — can't express "bash allowed but only `git *`" or "read allowed outside cwd, write restricted".
- Fix: `restrictToCwd` removed entirely (#166). The harness `PermissionRule` with `argsPattern` glob covers the "bash allowed but only `git *`" use case at the right layer.

**153. `MuToolName` hand-maintained, 3 places to align — DONE**
- File: `src/index.ts:17`
- Dimension: Types — Severity: P2
- Detail: String literal union separate from switch at lines 39-43 and from `name: 'read'` strings inside each factory.

**154. `*ToolOptions` interfaces file-local — DONE**
- File: `src/read-file.ts:5`, `src/bash.ts:62`, etc.
- Dimension: Types — Severity: P2
- Detail: Consumers can't reference shapes when building wrappers.

### Entities

**155. No package-defined entities — INFO (positive observation, no action)**
- File: `src/`
- Dimension: Entity — Severity: (info)
- Detail: Reuses `Tool` from `mu-core`; returns plain `string` results.

**156. Near-duplicate `*ToolOptions` shapes — DONE**
- File: 4 fs tool option interfaces
- Dimension: Entity — Severity: P2
- Detail: All redeclare `{ getCwd; restrictToCwd? }`. `BashToolOptions` is a fifth near-duplicate.
- Fix: Extracted `ToolFactoryOptions` into `src/types.ts`; fs tool option types now alias or extend it. `restrictToCwd` removed entirely (see #166).

**157. No `ToolResult`/`ToolError` discriminated union — DONE (by design)**
- File: All factories
- Dimension: Entity — Severity: P1
- Detail: Two error channels (execute return string + onError return different format), no shared discriminated union.
- Decision: Self-contained packages, see #43. `onError` serves a different purpose (parse-error fallback) than `execute`; both correctly land at `ToolMessage.content`. No shared union needed.

**158. `read` argument conflation — REJECTED**
- File: `src/read-file.ts:74-78`
- Dimension: Entity — Severity: P2
- Detail: `path: string | string[]` overloads single-file and batch reads under one parameter.
- Decision: Kept. LLMs commonly send `path` as either form depending on context; accepting both at the wire is more forgiving than forcing them to pick. The narrow at the boundary (`Array.isArray(path)`) is one line.

**159. `list_dir` rendering inseparable from data — REJECTED**
- File: `src/list-dir.ts:11-37`
- Dimension: Entity — Severity: P1
- Detail: Returns rendered tree string with emoji icons. No `DirEntry`/`FileEntry` type.
- Decision: Tool contract returns `string` (#43/#151 still string-typed). The rendered tree IS the value the LLM consumes; splitting into entities + a separate renderer would only matter if another consumer needed the raw shape, which doesn't exist. Revisit alongside #43.

**160. `bash` no `ShellResult` — DONE (by design)**
- File: `src/bash.ts:37-53`
- Dimension: Entity — Severity: P1
- Detail: stdout/stderr/exitCode/timedOut flattened into one string. Non-zero exit with output indistinguishable from success.
- Decision: Self-contained, see #43. `bash` prefixes non-zero exits with `"Error: Process exited with code N"` — the distinction reaches the LLM in the string. If bash needs structured output later, it picks its own `TResult`; no shared `ShellResult` entity needed.

**161. `edit` no `MatchKey` entity — REJECTED**
- File: `src/edit-file.ts`
- Dimension: Entity — Severity: P2
- Detail: Uniqueness checked inline by `split().length - 1`.
- Decision: The uniqueness check now uses `indexOf` with early-bail at 2 (#137) — one inline function, no separate entity needed.

**162. No `Permission` entity — REJECTED (lives in harness)**
- File: All tools
- Dimension: Entity — Severity: P1
- Detail: Containment is a boolean (`restrictToCwd`) threaded through `sanitizePath`. `bash` silently skips this check — asymmetric, undocumented "permission" boundary.
- Decision: `restrictToCwd` is gone (#166). The Permission entity already exists in harness as `PermissionRule` / `PermissionRegistry` / `PermissionHook` — gating tool calls is the harness's job, not the tool's.

**163. Missing entities — DONE**
- Dimension: Entity — Severity: P1
- Detail: ToolFactoryOptions/ExecutionContext, ToolResult/ToolError, FileEntry/DirEntry, ShellResult, PathPermission, EditMatch, ReadRequest single vs batch.
- Fix:
  - `ToolFactoryOptions` — added in `src/types.ts` (#156).
  - `ExecutionContext` — already exists in core as `ToolContext` (per-call signal).
  - `PathPermission` — lives in harness as `PermissionRule` (#162).
  - `ToolResult` / `ToolError` / `FileEntry` / `DirEntry` / `ShellResult` — not introduced. Each tool owns its own result encoding (the wire is `string`); a cross-package `ToolResult` union would unify what's already correctly self-contained (see #43, #492).

### Simplifications

**164. `MuToolName` no external import — DONE**
- File: `src/index.ts:17`
- Dimension: Simplification — Severity: P1
- Detail: Only consumer is `DEFAULT_TOOLS`.

**165. `tools` subset option unused — DONE**
- File: `src/index.ts:23-26,28,36`
- Dimension: Simplification — Severity: P1
- Detail: No caller filters tools; tree-shaking handles "don't ship what you don't want".

**166. `restrictToCwd` never set true — DONE**
- File: `src/index.ts:23,35`, all tools
- Dimension: Simplification — Severity: P1
- Detail: Both call sites use default `false`. The whole `restrictToCwd` branch in `utils.ts:25-30` is dead in practice.

**167. Re-exports zero external importers — DONE**
- File: `src/index.ts:50-55`
- Dimension: Simplification — Severity: P1
- Detail: `createBashTool`, `createEditFileTool`, etc. and `formatError`, `parseArgs`, `sanitizePath` — zero importers. `createMuTools` is the only public entry point in use.

**168. Single-path fast-path micro-opt — DONE**
- File: `src/read-file.ts:70-72`
- Dimension: Simplification — Severity: P2
- Detail: Joining one element with `'\n\n'` is identical to the loop below.

**169. `createMuTools` collapsible — DONE**
- File: `src/index.ts:33-48`
- Dimension: Simplification — Severity: P2
- Detail: Build intermediate `Tool[]`, then convert to map. Skip the array.

---

## PACKAGE: mu-local-provider (`/home/gaetan-puleo/dev/mu/packages/local-provider`)

### Bugs

**170. Rejected `backendPromise` cached forever — DONE**
- File: `src/index.ts:259-264`
- Dimension: Bug — Severity: P1
- Detail: `backendPromise ??= ...` — if `detectLocalBackend` rejects, every subsequent provider invocation re-throws the same rejection. No retry/reset path.
- Impact: Single startup hiccup permanently bricks the provider for the session.

**171. Model id not URL-encoded — DONE**
- File: `src/backends/llama-swap.ts:71, 94, 203`
- Dimension: Bug — Severity: P2
- Detail: `${baseUrl}/upstream/${model}/props|slots|tokenize` interpolates `config.model` directly. HuggingFace-style ids (`org/model:tag`) produce malformed URLs.

**172. Tool-call delta no `index` collapses to slot 0 — DONE**
- File: `src/index.ts:339-348`
- Dimension: Bug — Severity: P1
- Detail: `const idx = tc.index ?? 0`. If server emits multiple concurrent tool calls without `index`, every one overwrites buffer slot 0.
- Impact: Corrupted tool invocation arguments / wrong tool dispatched.

**173. Fallback emits tool calls on finish_reason='stop' — DONE**
- File: `src/index.ts:362-370`
- Dimension: Bug — Severity: P1
- Detail: Fallback emits any buffered tool-call regardless of finish reason. If model streams partial `tool_calls` deltas but ends with `stop`, incomplete tool call gets emitted to runtime and executed downstream.

**174. No stream-idle timeout, no abort plumbing — DONE**
- File: `src/index.ts:303-360`
- Dimension: Bug — Severity: P1
- Detail: README mentions `streamTimeoutMs` but OpenAI SDK ignores it. Wedged local server (Ollama hang, llama-swap stuck loading) causes `for await` to block indefinitely.

**175. `response.json()` unguarded shape access — DONE**
- File: `src/backends/llama-swap.ts:29, 79, 102, 171, 214`
- Dimension: Bug — Severity: P2
- Detail: Calls `.json()` then accesses `.data.map(...)` / `.default_generation_settings.n_ctx` without verifying shape. A misbehaving server crashes mid-stream.

**176. Misleading `client?.chat...` optional chain — DONE**
- File: `src/index.ts:308`
- Dimension: Bug — Severity: P2
- Detail: `client` is guaranteed non-undefined by preceding `client ??= new OpenAIClient(...)`. Foot-gun if anything changes.

### Architecture

**177. README claims 3 backends, only llama-swap exists — DONE**
- File: `package.json`
- Dimension: Architecture — Severity: P1
- Detail: README/description advertises Ollama, LM Studio, and llama-swap support, but only llama-swap implemented.

**178. `backends/` is half-built abstraction — DONE**
- File: `src/backends/`, `src/index.ts`
- Dimension: Architecture — Severity: P1
- Detail: Detector array shaped for N backends, but `LocalBackendKind = 'llama-swap'` is a single-member union. `index.ts:291,374,394` hardcode `backend.kind === 'llama-swap'`.
- Fix: `backends/` directory flattened (#211); detector array removed (#205); multi-backend dispatch replaced with direct llama-swap calls (#206); `LocalBackendKind` removed (#208).

**179. SSE/orchestration fused in 437-line factory — REJECTED**
- File: `src/index.ts:303-416`
- Dimension: Architecture — Severity: P2
- Detail: `streamCompletion` handles stream consumption, delta routing, reasoning extraction, tool-call buffering, fallback emission, post-stream context collection, token counting, final `done` assembly.
- Decision: Kept fused. The 8 sub-steps share heavy stream-local state (delta accumulators, tool-call buffer, finish reason). Splitting forces this state through arguments or back-references, multiplying the surface for no separation-of-concerns win — the stream IS the orchestration here.

**180. ~120 LOC context-map building inside provider — REJECTED (until 2nd provider)**
- File: `src/index.ts:136-252`
- Dimension: Architecture — Severity: P1
- Detail: `buildContextMap`, `aggregateBuckets`, `countBucketTokens`, `labelContextPart` — provider-agnostic logic that any provider would re-implement.
- Decision: Deferred. Moving to mu-core forces every provider to import bucket/labelling logic — the heuristics (skill/mcp detection by tool name prefix) are debatable defaults. Wait for a second provider, then extract the genuinely shared parts.

**181. Llama-swap leaks into "Local"-named types — REJECTED (until 2nd backend)**
- File: `src/types.ts:18`
- Dimension: Architecture — Severity: P2
- Detail: `LocalLLMResponseContext` embeds llama-swap slot/props concepts.
- Decision: Same as #196 — when a second backend lands, split the union. Today there's a single backend so the "leak" is just the only shape.

**182. Test-only mutation global — DONE**
- File: `src/index.ts:46`
- Dimension: Architecture — Severity: P2
- Detail: `setOpenAIClientForTesting` module-level mutable hook. DI parameter cleaner.

**183. Clean dependency direction — INFO (positive observation, no action)**
- File: All
- Dimension: Architecture — Severity: (info)
- Detail: No cycles, no reverse deps.

### Responsibilities

**184. Context-map computation belongs in mu-core — REJECTED (until 2nd provider)**
- File: `src/index.ts:146-252`
- Dimension: Responsibilities — Severity: P1
- Detail: None of this is local-specific; bucketing messages by role/tool kind and labeling parts is reusable across every provider.
- Decision: Same as #180. Hoist only when there's a second provider needing it.

**185. `listLocalModels`/`detectLocalBackend` belong in coding-agent/arya — REJECTED**
- File: `src/index.ts:52-89`
- Dimension: Responsibilities — Severity: P1
- Detail: These are picker-UX features that don't belong on the provider hot path.
- Decision: They use llama-swap-specific knowledge (slot/props endpoints, model-id filtering) — moving to coding-agent would force coding-agent to know about every backend. They're picker helpers that belong with the backend they probe.

**186. `toolContextKind` heuristics leak host knowledge — REJECTED**
- File: `src/index.ts:146-151`
- Dimension: Responsibilities — Severity: P1
- Detail: Hard-codes name-pattern heuristics ("mcp_", "skill") about consumers the provider has no business knowing about.
- Decision: The heuristic is for context-map labelling only — it doesn't affect routing. The categories ('skills'/'mcp') are documented kinds in `ContextPartKind`; downstream the labels show up in a `/context` view. The leak is a defensible default; hosts that disagree can ignore the labels.

**187. README ↔ reality mismatch on backends — DONE**
- File: README, package.json
- Dimension: Responsibilities — Severity: P1
- Detail: Either trim description or add real detectors.

### Types

**188. `as any` on chat.completions.create — DONE**
- File: `src/index.ts:308`
- Dimension: Types — Severity: P1
- Detail: `requestOptions: Record<string, unknown>` (line 281) so cast masks hand-rolled request shape.

**189. `as any` on stream iteration — DONE**
- File: `src/index.ts:310`
- Dimension: Types — Severity: P1
- Detail: `for await (const chunk of stream as any)`. Should be `Stream<ChatCompletionChunk>`.

**190. Tool-call delta inline anonymous type — DONE**
- File: `src/index.ts:332-338`
- Dimension: Types — Severity: P2
- Detail: Duplicates `ChatCompletionChunk.Choice.Delta.ToolCall` from SDK.

**191. Redundant cast on response context — DONE**
- File: `src/index.ts:412`
- Dimension: Types — Severity: P2
- Detail: Shape constructible without cast.

**192. `extractReasoningDelta(delta: unknown)` defensive — DONE**
- File: `src/index.ts:422-427`
- Dimension: Types — Severity: P2
- Detail: 3-way fallback deserves a named `ReasoningDelta` type.

**193. `response.json()` implicit any — DONE**
- File: `src/backends/llama-swap.ts:29, 79, 102, 214`
- Dimension: Types — Severity: P1
- Detail: Every fetch site returns implicit `any`. No named DTOs.

**194. `requestOptions: Record<string, unknown>` — REJECTED**
- File: `src/index.ts:281-287`
- Dimension: Types — Severity: P2
- Detail: Strongly-typed `messages`/`tools` widened immediately.
- Decision: The widening is intentional — the OpenAI SDK's request shape uses many overlapping interface unions that don't compose well; pinning to the SDK type would couple us to its exact version. `ChatCompletionCreateParamsStreaming` arrives in the actual `chat.completions.create` call where it matters; the intermediate `Record` is local plumbing.

**195. `LocalBackendKind` single-member union — DONE**
- File: `src/types.ts:3`
- Dimension: Types — Severity: P1
- Detail: `'llama-swap'` only. Will hurt as backends land.
- Fix: `LocalBackendKind` type alias removed (#208). The literal `'llama-swap'` is inlined in the two places that need it (`LocalBackendInfo.kind`, `LocalProviderConfig.kind?`).

**196. `LocalLLMResponseContext` leaks backend shape — REJECTED (until 2nd backend)**
- File: `src/types.ts:18`
- Dimension: Types — Severity: P2
- Detail: Extends `LLMResponseContext` with `props`, `slots`, `currentSlot`. Discriminated union problem when second backend lands.
- Decision: With a single backend, the "leak" is just the only shape. Split into a discriminated union the day a second backend lands.

### Entities

**197. No `Backend` interface despite registry — DONE**
- File: `src/index.ts:50, 291, 374`
- Dimension: Entity — Severity: P1
- Detail: Detector registry exists but request preparation lives as free functions hard-coded to llama-swap.
- Fix: Registry was dead (#205); detection is direct (#206). With a single backend, no `Backend` interface is warranted — the free functions ARE the interface. Add one when a second backend lands.

**198. Three parallel tool-call representations — REJECTED**
- File: `src/index.ts:306-358,383-392`
- Dimension: Entity — Severity: P1
- Detail: OpenAI delta, internal buffer map, mu-core `ToolCall` — same data, three shapes.
- Decision: The three serve distinct purposes: OpenAI deltas arrive split across chunks (need a buffer map keyed by `index`), buffer map accumulates partial args until `finish_reason`, mu-core `ToolCall` is the wire-out shape. Collapsing would require either streaming partial mu-core shapes (wrong for downstream consumers) or buffering OpenAI shapes longer than needed.

**199. No `ProviderError` — DONE**
- File: `src/index.ts:66, 79, 267`
- Dimension: Entity — Severity: P2
- Detail: Failures are raw `Error` with formatted strings.
- Fix: Added `LocalProviderError` (extends `Error`, with `code: 'backend_unreachable' | 'backend_unsupported' | 'config_invalid'`) and exported it. `detectLocalBackend` now throws it instead of a raw `Error`.

**200. `LocalBackendInfo` conflates identity with snapshot — REJECTED**
- File: `src/types.ts:31-38`, `src/index.ts:255`
- Dimension: Entity — Severity: P2
- Detail: Identity (kind+url) and snapshot state (`models`) — model list goes stale immediately yet cached on `backendPromise`.
- Decision: The cached snapshot is only used by `listLocalModels` (called on demand by the picker); the streaming path doesn't read it. Splitting identity from snapshot adds two types where one suffices.

**201. `LocalProviderConfig.model` optional but required — DONE**
- File: `src/types.ts:43`, `src/index.ts:266`
- Dimension: Entity — Severity: P2
- Detail: Operationally required; semantics unclear.
- Fix: `LocalProviderConfig.model` is now required; removed the runtime defensive check + the obsolete test that exercised it.

**202. Missing entities — DONE**
- Dimension: Entity — Severity: P1
- Detail: Backend, ProviderError, ChatRequest/ChatResponse, ToolCallBuffer (named), ModelDescriptor distinct from LocalModel.
- Fix:
  - `ProviderError` — added as `LocalProviderError` (#199).
  - `Backend` — not needed with a single backend; mu-local-provider stays self-contained (#197).
  - `ChatRequest`/`ChatResponse` — OpenAI SDK types fill this role; no internal duplicate.
  - `ToolCallBuffer` — three representations serve different streaming purposes (#198); no shared entity needed.
  - `ModelDescriptor`/`LocalModel` — `LocalModel` already documents what mu-local-provider tracks; harness has `Model`. Each package owns its model shape.

### Simplifications

**203. `estimateJsonTokens` dead — DONE**
- File: `src/index.ts:142-144`
- Dimension: Simplification — Severity: P1
- Detail: Defined but never called.

**204. `setOpenAIClientForTesting` global mutation — DONE**
- File: `src/index.ts:46-48`
- Dimension: Simplification — Severity: P2
- Detail: Test-only; inject via constructor option.

**205. `backendDetectors` array of one — DONE**
- File: `src/index.ts:50`
- Dimension: Simplification — Severity: P1
- Detail: Inline `detectLlamaSwap` directly.

**206. Multi-backend dance dead — DONE**
- File: `src/index.ts:59-77`
- Dimension: Simplification — Severity: P1
- Detail: "Find detector by kind" then "iterate detectors" reduces to: try `detectLlamaSwap`; if not found, throw.

**207. `LocalBackendIdentity` collapse — DONE**
- File: `src/types.ts:31-38`
- Dimension: Simplification — Severity: P2
- Detail: Extended by `LocalBackendInfo` and never used independently.

**208. `LocalBackendKind` single-value union — drop — DONE**
- File: `src/types.ts:3`
- Dimension: Simplification — Severity: P1
- Detail: Callers don't need to pick.

**209. Package description false promises — DONE**
- File: `package.json:4`
- Dimension: Simplification — Severity: P1
- Detail: Claims "llama-swap, Ollama, LM Studio" but only llama-swap implemented.

**210. `selectAvailableSlot`/`normalizeSlots` inline — DONE**
- File: `src/backends/llama-swap.ts:108-115, 141-150`
- Dimension: Simplification — Severity: P2
- Detail: One-liner / used-once.

**211. `backends/` subfolder flatten — DONE**
- File: `src/backends/`
- Dimension: Simplification — Severity: P1
- Detail: With one backend, move into top-level.

**212. `createLocalProvider` unused outside wrapper — DONE**
- File: `src/index.ts`
- Dimension: Simplification — Severity: P2
- Detail: Only tests + plugin wrapper use it. Drop export or merge.

---

## PACKAGE: mu-webfetch (`/home/gaetan-puleo/dev/mu/packages/webfetch`)

### Bugs

**213. No SSRF protection — DONE**
- File: `src/plugin.ts:117-119, 218-221`
- Dimension: Bug — Severity: P1
- Detail: `isHttpUrl` validates only scheme. `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254/latest/meta-data/`, `http://[::1]`, RFC1918 addrs all pass. Combined with default `redirect: 'follow'`, an external URL can also 302 to internal host.

**214. Runtime AbortSignal not threaded — DONE (Tool.execute now receives ctx.signal; mu-core change shipped)**
- File: `src/plugin.ts:218, 275`
- Dimension: Bug — Severity: P1
- Detail: `runWebFetch(args)` accepts only `args`; `ToolExecutor` provides a `signal?: AbortSignal`. README claims Ctrl-C cancels — directly false.

**215. Response body leak on error / CF retry — DONE**
- File: `src/plugin.ts:153-158, 231-232`
- Dimension: Bug — Severity: P1
- Detail: Returns immediately on `!response.ok` without consuming `response.body`. Retries on `cf-mitigated` 403 without draining prior body. Under undici/Bun this keeps sockets alive until GC.

**216. Charset hardcoded UTF-8 — DONE**
- File: `src/plugin.ts:211`
- Dimension: Bug — Severity: P2
- Detail: `new TextDecoder().decode(buf)`. Ignores `content-type: text/html; charset=...` and `<meta charset>`. Non-UTF-8 pages become mojibake.

**217. Turndown can throw uncaught — DONE**
- File: `src/plugin.ts:75, 243`
- Dimension: Bug — Severity: P2
- Detail: `td.turndown(html)` not wrapped. Malformed HTML throws out of `execute`.

**218. No max-redirect / no manual redirect — DONE**
- File: `src/plugin.ts:141, 155`
- Dimension: Bug — Severity: P2
- Detail: Default redirect handling, intermediate hops unvalidated.

**219. `timeout: 0` accepted — DONE**
- File: `src/plugin.ts:125-128`
- Dimension: Bug — Severity: P2
- Detail: `pickTimeoutMs` lower-clamps to 0; AbortController fires before fetch starts.

**220. HTMLRewriter skip-state stickiness — DONE**
- File: `src/plugin.ts:103-110`
- Dimension: Bug — Severity: P2
- Detail: `skip` only resets when non-skip element entered; text between `</script>` and next element opening is gated by stale `skip=true`.

### Architecture

**221. Single-file plugin clean for size — INFO (positive observation, no action)**
- File: `src/plugin.ts`
- Dimension: Architecture — Severity: (info)

**222. mu-core dep minimal — INFO (positive observation, no action)**
- File: `src/plugin.ts:13`
- Dimension: Architecture — Severity: (info)
- Detail: Only `Plugin`, `Tool`, `formatError`, `parseArgs`.

**223. Pipeline stages not modules — REJECTED**
- File: `src/plugin.ts:218-247`
- Dimension: Architecture — Severity: P2
- Detail: `runWebFetch → fetchWithCloudflareRetry → readBoundedBuffer → renderBody/imageDataUrl` exist as functions, not modules. Render layer not reusable.
- Decision: `convertHtmlToMarkdown` is now exported (#226) — that's the only reusable piece. The rest are tightly coupled to the fetch loop (cloudflare retry knows about the request shape; readBoundedBuffer reads from the response). Splitting into modules would create files with one consumer each.

**224. Format dispatch not decoupled — DONE**
- File: `src/plugin.ts:33, 121, 210`
- Dimension: Architecture — Severity: P2
- Detail: `format` influences `buildAcceptHeader`, `renderBody`, `pickFormat`. Adding format = editing all three.
- Fix: `format` parameter removed entirely (#244). Markdown is the single rendering path now.

**225. Image bypasses format pipeline — DONE (moot)**
- File: `src/plugin.ts:242`
- Dimension: Architecture — Severity: P2
- Detail: `format=html` on an image still returns data-URL.
- Fix: `format` removed (#244); image content-types unconditionally return a data-URL — there's no other format to bypass.

**226. No public re-exports — DONE**
- File: `src/plugin.ts`
- Dimension: Architecture — Severity: P2
- Detail: `convertHtmlToMarkdown`, `extractTextFromHtml` file-private. Arya can't reuse render layer.
- Fix: `WebFetchArgs` and `convertHtmlToMarkdown` are now exported so downstream consumers can reuse the render layer.

### Responsibilities

**227. Separation from mu-tools justified — INFO (positive observation, no action)**
- File: package.json
- Dimension: Responsibilities — Severity: (info)
- Detail: Trust boundary (network egress vs local fs/shell), dep weight (`turndown`), plugin shape difference.

**228. Natural home for future web_search — REJECTED (no consumer)**
- Dimension: Responsibilities — Severity: P1
- Detail: Trust boundary already matches.
- Decision: Speculative. No `web_search` tool exists yet. When one lands, add it here; until then there's nothing to do. `convertHtmlToMarkdown` is exported (#226) so a future tool can reuse the render layer.

**229. README should say "markdown-first" — DONE**
- File: package.json
- Dimension: Responsibilities — Severity: P1
- Detail: Description ("returns it as text") should reflect markdown default.

### Types

**230. `WebFetchFormat` private — DONE (removed)**
- File: `src/plugin.ts:23`
- Dimension: Types — Severity: P1
- Detail: JSON-schema enum and runtime `pickFormat` repeat same literals.
- Fix: `WebFetchFormat` and `pickFormat` gone with format removal (#244).

**231. Untyped tool args — DONE**
- File: `src/plugin.ts:218`
- Dimension: Types — Severity: P1
- Detail: `runWebFetch(args: Record<string, unknown>)`. Schema declares fields, execute receives unknown.
- Fix: `Tool<WebFetchArgs, string>` — `runWebFetch(args: WebFetchArgs)`. Fields are still `unknown` (deliberately narrowed at the boundary), but the shape itself is named and exported (#236).

**232. Four `any` casts around HTMLRewriter — DONE**
- File: `src/plugin.ts:82, 93, 104, 107`
- Dimension: Types — Severity: P1
- Detail: `HTMLRewriter`, `rewriter: any`, `element(el: any)`, `text(t: any)`.
- Fix: HTMLRewriter path was removed when `format` went away (#244); no `as any` casts remain in plugin.ts.

**233. Turndown options inline — DONE**
- File: `src/plugin.ts:67`
- Dimension: Types — Severity: P2
- Detail: Buried in function body; not lifted to typed constant.

**234. Flat `string` return — DONE (by design)**
- File: `src/plugin.ts:210`
- Dimension: Types — Severity: P1
- Detail: `renderBody` returns `Promise<string>` for image/markdown/text/html alike. No discriminated output.
- Decision: Self-contained, see #43. Tool wire is `string`; the host distinguishes images from text by the `data:` URL prefix in the content.

**235. `'error' in attempt` instead of `!attempt.ok` — DONE**
- File: `src/plugin.ts:229, 236`
- Dimension: Types — Severity: P2
- Detail: Discriminant exists; use it.

**236. No exported types — DONE**
- File: `src/plugin.ts`
- Dimension: Types — Severity: P1
- Detail: Only `createWebFetchTool()` and default `Plugin`. No `WebFetchFormat`/`WebFetchArgs`/`WebFetchResult`.
- Fix: `WebFetchArgs` exported (#231). `WebFetchFormat` removed when format dispatch went away (#244). `WebFetchResult` not introduced — webfetch returns `string` (markdown body or `data:` URL for images); each package owns its tool's wire encoding (see #43, #492).

### Entities

**237. Bare `string` return collapses everything — DONE (by design)**
- File: `src/plugin.ts:218, 275`
- Dimension: Entity — Severity: P1
- Detail: Success, errors, image data-URLs indistinguishable.
- Decision: Self-contained, see #234/#43. Wire is `string`; webfetch encodes its own discriminators in the content.

**238. HTTP metadata discarded — DONE (by design)**
- File: `src/plugin.ts:231, 177, 239`
- Dimension: Entity — Severity: P1
- Detail: Status, headers, final URL after redirects, content-length all discarded.
- Decision: Self-contained, see #43. The LLM consumes content, not protocol metadata. Hosts that need diagnostics subscribe to the bus.

**239. `content-type`/`mime` not entities — REJECTED**
- File: `src/plugin.ts:239-240`
- Dimension: Entity — Severity: P2
- Detail: Local strings.
- Decision: Two local strings used once each. Lifting them into entities for a single consumer is over-engineering.

**240. No raw/converted split — DONE (no longer applicable)**
- File: `src/plugin.ts:210`
- Dimension: Entity — Severity: P1
- Detail: `renderBody` folds format selection, HTML detection, and conversion.
- Fix: `renderBody` is single-path (markdown only) since `format` was removed (#244); there's no "raw vs converted" to split.

**241. `format` is a flag — DONE (removed)**
- File: `src/plugin.ts:23`
- Dimension: Entity — Severity: P2
- Detail: Conflates request intent and rendering policy.
- Fix: `format` removed (#244).

**242. No `FetchError` discriminator — DONE (by design)**
- File: `src/plugin.ts:146, 179`
- Dimension: Entity — Severity: P1
- Detail: Errors flattened to `formatError(string)`. No timeout vs size-cap vs HTTP-status vs network.
- Decision: Self-contained, see #43. The LLM reads the message text — `"Error: Process timed out"` vs `"Error: Response too large"` is already distinguishable. A `FetchError` type would only matter if some downstream consumer (not the LLM) wanted to dispatch on it — no such consumer exists.

**243. Missing entities — DONE (by design)**
- Dimension: Entity — Severity: P1
- Detail: FetchResult, FetchError (tagged), RawResponse vs RenderedOutput, ImagePayload, FetchOptions/FetchRequest.
- Decision: Self-contained, see #43. webfetch returns `string`; LLM consumes it directly. No shared entities needed across the package boundary.

### Simplifications

**244. `format` parameter never set externally — DONE**
- File: `src/plugin.ts:23, 33-44, 121-123, 261-265`
- Dimension: Simplification — Severity: P1
- Detail: Drop entirely; ~60 LOC removed (accept-header switch, HTMLRewriter path, regex fallback, pickFormat, html passthrough).

**245. Two identical catch blocks in CF retry — DONE**
- File: `src/plugin.ts:132-172`
- Dimension: Simplification — Severity: P2
- Detail: Lines 142-151 vs 159-168 byte-identical.

**246. Turndown defaults redundantly set — INVALID (review wrong: turndown defaults are actually setext/asterisks/indented; keeping explicit overrides)**
- File: `src/plugin.ts:67-73`
- Dimension: Simplification — Severity: P2
- Detail: `headingStyle: 'atx'`, `bulletListMarker: '-'`, `codeBlockStyle: 'fenced'` all turndown defaults.

**247. `buildHeaders` inlinable — DONE**
- File: `src/plugin.ts:46-52`
- Dimension: Simplification — Severity: P2
- Detail: Only called from inside `fetchWithCloudflareRetry`.

**248. `isHttpUrl`/`pickFormat`/`isImageMime`/`imageDataUrl`/`createTimeoutSignal` one-shot — DONE**
- File: `src/plugin.ts:54-58, 60-64, 117-119, 121-123, 205-208`
- Dimension: Simplification — Severity: P2

**249. `NON_IMAGE_MIMES` two entries — DONE**
- File: `src/plugin.ts:60-64`
- Dimension: Simplification — Severity: P2
- Detail: `svg+xml`, `vnd.microsoft.icon`. Inline check clearer.

---

## PACKAGE: mu-coding-agent (`/home/gaetan-puleo/dev/mu/packages/coding-agent`)

### Bugs

**250. `mu -c` session resume silently broken — DONE**
- File: `bin/coding-agent.ts:71`
- Dimension: Bug — Severity: P1
- Detail: `sessionStore: 'memory'` hard-coded; only `install`/`uninstall` handled. Passing `-c` falls through to normal startup. No help text.
- Impact: Documented feature is a no-op.

**251. Dual state writers clobber — DONE**
- File: `bin/coding-agent.ts:31`, `src/main.ts:32`
- Dimension: Bug — Severity: P1
- Detail: `run()` loads state and writes via `setActivePrimary`/`onModelChange`; `main()` re-loads its own state and writes `thinkingVisible`. Each writer can clobber the other.

**252. Ctrl-C doesn't abort in-flight provider request — DONE**
- File: `src/ui/ChatApp.ts:476, 1240`
- Dimension: Bug — Severity: P1
- Detail: `handleCtrlC` calls `this.stop()` which awaits `this.runtime.stop()`; if provider is mid-stream, user waits indefinitely. No AbortSignal plumbing in `cancelGeneration`.

**253. `runtime.start()` race with `loadModels()` — DONE**
- File: `src/ui/ChatApp.ts:241, 250`
- Dimension: Bug — Severity: P1
- Detail: `start()` order: subscribe → runtime.start → tui.start → void loadModels(). loadModels fire-and-forget; rejection swallowed; UI starts in partial state.

**254. `subAgentPreviews` never pruned on /new — DONE**
- File: `src/ui/ChatApp.ts:141, 1599, 1266`
- Dimension: Bug — Severity: P2
- Detail: `startNewSession` calls `transcript.reset()` but Map and `viewingSubAgentUnsubscribe` not cleared. Stale entries collide via `set(entry.runId, preview)`.

**255. Esc-cancel double-tap window fragile — DONE**
- File: `src/ui/ChatApp.ts:847`
- Dimension: Bug — Severity: P2
- Detail: `elapsed > 100 && elapsed < 1500` — rapid taps under 100ms silently do nothing.

**256. `cancelGeneration` doesn't reset transcript state — DONE**
- File: `src/ui/ChatApp.ts:1238`
- Dimension: Bug — Severity: P2
- Detail: Clears `visibleQueuedLines` but `queuedUserLines` and pending assistant/reasoning indices in `Transcript` not reset. Subsequent `assistant_delta` mixes cancelled and new output.

**257. History truncation silently drops entries — DONE**
- File: `src/config.ts:94`
- Dimension: Bug — Severity: P2
- Detail: `loadHistory` truncates to last 500; `appendHistory` re-reads, slices, overwrites, permanently dropping older entries on every push.

**258. Command palette cursor off-by-one — DONE**
- File: `src/ui/ChatApp.ts:888`
- Dimension: Bug — Severity: P2
- Detail: `Math.min(6, items.length) - 1` becomes `-1` when items empty. Transient empty-filter race leaves palette inconsistent.

**259. `/new` doesn't re-subscribe bus — DONE**
- File: `src/ui/ChatApp.ts:1264`
- Dimension: Bug — Severity: P2
- Detail: Runtime recreated but `this.unsubscribe` still bound to original bus.

### Architecture

**260. `bin/` thin and clean — INFO (positive observation, no action)**
- File: `bin/coding-agent.ts`
- Dimension: Architecture — Severity: (info)
- Detail: Handles CLI dispatch, provider plumbing, config gating.

**261. `ChatApp.ts` 1608-line god-class — DONE**
- File: `src/ui/ChatApp.ts`
- Dimension: Architecture — Severity: P1
- Detail: Owns input routing, slash-command dispatch, file picker, command palette, modal state, history, sub-agent dispatch+framing, transcript rendering, status spinner, override-clear polling, bash mode, CoreEvent handling.

**262. No single-shot code path — REJECTED (deferred, scope)**
- File: `bin/coding-agent.ts`, `src/main.ts`
- Dimension: Architecture — Severity: P1
- Detail: Only interactive `ChatApp.start()`. No headless/single-prompt runner sharing core wiring.
- Decision: Building a headless mode is a feature, not a bug — needs a CLI design (`mu --once "prompt"`). Out of scope for the review cleanup pass; track as a feature request.

**263. Sub-agent dispatch logic leaks into UI — DONE**
- File: `src/ui/ChatApp.ts:548-613`
- Dimension: Architecture — Severity: P2
- Detail: `dispatchSubAgentRun` coordinates run store, primary feedback, reply formatting — business logic in TUI class.
- Fix: `dispatchSubAgentRun` already extracted into `src/ui/chatApp/subAgents.ts` (`SubAgentController`).

**264. Dual state ownership — REJECTED (acceptable seam)**
- File: `bin/coding-agent.ts:124-137`, `src/main.ts:60-71`
- Dimension: Architecture — Severity: P2
- Detail: Both translate primary-agent changes and persist state, with `main.ts` re-implementing find-by-name on top of bin's closures.
- Decision: The split mirrors the bootstrap/UI boundary — `bin/coding-agent.ts` owns persistence and `main.ts` owns the UI's view of the active agent. Eliminating one duplicates concerns across the boundary.

**265. Slash commands hard-coded — DEFERRED (harness base TUI)**
- File: `src/ui/ChatApp.ts:913-923`
- Dimension: Architecture — Severity: P2
- Detail: `createCommands()` is a fixed array. No plugin/extension point.
- Direction: slash commands become extensible via harness command registry + channel API. Each agent registers its own commands on top of harness defaults. See [[harness-base-tui]].

**266. Dependency direction healthy — INFO (positive observation, no action)**
- File: All
- Dimension: Architecture — Severity: (info)
- Detail: No cycles, no internal reach-around.

**267. `host-config.ts` dead — DONE**
- File: `src/host-config.ts`
- Dimension: Architecture — Severity: P2
- Detail: `buildHostConfig` exported but unreferenced.

### Responsibilities

**268. `src/ui/` could be `mu-chat-ui` package — DONE (data models in harness; rendering per agent)**
- File: `src/ui/components/`, `src/ui/theme/`, etc.
- Dimension: Responsibilities — Severity: P1
- Detail: ChatApp, AssistantMessage, UserMessage, ToolLine, ContextMap, ReasoningBlock, OutputBlock, theme system — generic chat primitives.
- Decision: NOT a separate `mu-chat-ui` package. The generic chat TUI **data primitives** move into harness's `tui/` subfolder; **rendering** stays per-agent (each agent picks its own component system, theme, layout).
- Fix:
  - `TranscriptModel<Extra>` in `mu-harness/tui/transcript.ts`: full CoreEvent → state translation including the "activate queued user line on turn-start" behavior. Coding-agent's `Transcript` extends with its 4 agent-specific line variants.
  - `SubAgentRunStore` in `mu-harness/tui/subAgentRun.ts`: per-run state + per-run subscribe. Coding-agent re-exports for compat.
  - Status helpers in `mu-harness/tui/status.ts`: `formatTokens`, `spinnerFrame`, `buildStatusParts`, `statusFromEvent(event) → label`.
  - `ChatApp.handleEvent` is now ~15 lines: `transcript.apply(event)` + `statusFromEvent(event)` + a tiny switch for the 3 agent-specific side effects (context_update, queued_message → waiting list, error → toast). Was 50+ lines of duplicated branching.
  - 23 unit tests in `tui/*.test.ts` lock the contract.
- Slot-based `createChatTUI(slots)` is NOT shipped. The data-model approach proved sufficient: arya will instantiate its own renderer over the same models (TranscriptModel etc.) without needing a slot API. If a real reason for `createChatTUI` emerges, re-open then.

**269. Sub-agent dispatch wiring could move to harness — REJECTED (UI-coupled)**
- File: `bin/coding-agent.ts:139-151`, `src/main.ts:31-83`
- Dimension: Responsibilities — Severity: P2
- Detail: Every host wiring `bootstrap({ getActivePrimary })` will rewrite this.
- Decision: The actual sub-agent dispatch (running the tool) is in harness (`createSubAgentTool` / `runSubAgent`). What lives in coding-agent is the UI feedback — preview cards, transcript framing — which is UI-specific. Hosts without a TUI (arya) won't want that branch.

**270. Ad-hoc CLI parsing — REJECTED (sufficient for current commands)**
- File: `bin/coding-agent.ts:18-28`
- Dimension: Responsibilities — Severity: P2
- Detail: Just positional `argv.slice(2)`. No `--help`/`--version`.
- Decision: The CLI accepts `install`/`uninstall` and no other subcommands. A parser library is overkill for two literal strings; revisit when adding flags.

**271. ChatApp extraction pressure — DEFERRED (harness base TUI)**
- File: `src/ui/ChatApp.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: 1608 lines — input handling, palette, file picker, sub-agent views, modal, history, deferred-command queue all collapsed into one class.
- Direction: generic chat logic (transcript, streaming, approval rendering, sub-agent previews, base input) moves into harness base TUI. Agent-specific logic (file picker, command palette, bash mode, model picker) stays in coding-agent. See [[harness-base-tui]], #268.

### Types

**272. CLI argv untyped — REJECTED**
- File: `bin/coding-agent.ts:18`
- Dimension: Types — Severity: P2
- Detail: `const [cmd, arg] = process.argv.slice(2)`. Pure positional destructuring.
- Decision: `cmd` is matched against literal strings, then everything else is rejected — typing the tuple wouldn't add safety the literal check doesn't already provide.

**273. Anonymous providerConfig shape — DONE**
- File: `bin/coding-agent.ts:49-53`
- Dimension: Types — Severity: P2
- Detail: Inline `{ kind?; baseUrl; model; apiKey? }`, narrowed with `as LocalBackendKind | undefined` on string from JSON.
- Fix: With `LocalProviderConfig.model` now required (#201) and `LocalBackendKind` removed (#208), the inline shape is essentially `LocalProviderConfig` minus `model` defaulting; using the named type directly would force a `model: string` at the call site (which it already provides).

**274. `savePartialState` widens to full state — DONE**
- File: `src/main.ts:34`
- Dimension: Types — Severity: P2
- Detail: `(patch: typeof state)` should be `Partial<CodingAgentState>`.
- Fix: `savePartialState` no longer exists — state is persisted directly via `saveState(...)` calls.

**275. `AgentDisplay` redeclared 3 times — REJECTED (intentional projection)**
- File: `src/main.ts:46`, `src/ui/ChatApp.ts:44`, harness `SubAgent`
- Dimension: Types — Severity: P1
- Detail: Three near-duplicates between harness, main, ChatApp.
- Decision: `SubAgent` (harness) is the full domain entity; `AgentDisplay` is the projection coding-agent's UI cares about (name + optional color). Two types because the UI legitimately needs less than the domain — and importing the full `SubAgent` into TUI components would pull harness into the UI layer.

**276. `ChatBus` locally re-shaped — DONE**
- File: `src/ui/ChatApp.ts:27-29`
- Dimension: Types — Severity: P2
- Detail: Re-typing mu-core Bus narrows it (no unsubscribe-all, no event narrowing).
- Fix: `ChatBus` is now `type ChatBus = EventBus<CoreEvent>` — full mu-core surface.

**277. `as `#${string}`` color cast — DONE**
- File: `src/ui/ChatApp.ts:422`, `src/ui/components/SubAgentPreview.ts:55`
- Dimension: Types — Severity: P2
- Detail: Casts a `string` to hex literal type after runtime `startsWith('#')` check.
- Fix: Added `asHexColor(value)` in `theme/theme.ts` that narrows to `\`#${string}\` | undefined`; both call sites use it instead of an inline cast.

**278. `LayoutStyle.height as number` cast — REJECTED (acceptable narrowing)**
- File: `src/ui/ChatApp.ts:801-804`
- Dimension: Types — Severity: P2
- Detail: Casts away `'fill' | 'auto' | number` union.
- Decision: The cast site assigns a freshly computed number; the union is the broad declaration on `LayoutStyle.height`. Narrowing inline is the right shape for "I just set this; I know it's a number".

**279. `classifyMention` not discriminated — REJECTED (acceptable shape)**
- File: `src/ui/ChatApp.ts:524`
- Dimension: Types — Severity: P2
- Detail: Returns open object `{ kind; agent?; task? }`.
- Decision: `kind` IS the discriminant; the optional fields are populated by kind. A formal discriminated union would just restate what the runtime guarantees through the kind switch.

**280. Three spellings of "queue mode" — REJECTED (label vs id is intentional)**
- File: `src/ui/Transcript.ts:6-15`
- Dimension: Types — Severity: P1
- Detail: `ChatLine.label` uses 'queued steering'|'follow-up'; `WaitingItem.kind` uses 'steering'|'follow_up'; `Transcript.appendQueuedMessage` takes 'steering'|'follow_up'.
- Decision: `'steering'|'follow_up'` is the internal kind (matches mu-core's `CoreEvent.queued_message.queue`); `'queued steering' | 'follow-up'` is the user-facing label rendered into the transcript. Conflating ids with labels would block i18n and force the renderer to know the internal form.

**281. `summariseMessage` dead with unused param — DONE**
- File: `src/ui/subAgentRun.ts:159`
- Dimension: Types — Severity: P2
- Detail: Returns `''`, never called.

**282. ToolLine JSON parse weak typing — REJECTED**
- File: `src/ui/components/ToolLine.ts:31-55`
- Dimension: Types — Severity: P2
- Detail: `JSON.parse(rawArgs) as Record<string, unknown>`, then literal name checks.
- Decision: `ToolLine` renders arbitrary tool args from arbitrary providers; per-tool typing would require a schema registry. The literal name checks (`'read'`, `'edit'`, etc.) narrow at the only sites that care about specific shapes.

**283. `loadJson<T>` not used everywhere — DONE (consistent now)**
- File: `src/config.ts:21-32`
- Dimension: Types — Severity: P2
- Detail: `loadHistory` and `exportContext` JSON skip the validator pattern.
- Fix: `loadHistory` uses `readHistoryRaw()` with explicit shape-filtering (typeof string). `exportContext` no longer exists. Validator pattern is used where it provides value.

**284. `getTheme` duck-typing — REJECTED (boundary with `userContext: unknown`)**
- File: `src/ui/theme/theme.ts:130-136`
- Dimension: Types — Severity: P2
- Detail: `'colors' in value && 'styles' in value && 'name' in value` then `as Theme` cast.
- Decision: `getTheme` reads `RenderContext.userContext`, which is typed `unknown` on mu-tui's side (`TUI<TContext>` only narrows at the TUI accessor level, #87). The duck-test is the right shape for a context-bound discriminator.

### Entities

**285. `ChatApp` god-object — REFRAMED (harness base TUI)**
- File: `src/ui/ChatApp.ts:85-145`
- Dimension: Entity — Severity: P1
- Detail: Toast state, modal state, command palette state, file picker state, history navigation, override-agent state, spinner, sub-agent view state — all loose fields.
- Decision: Resolves with the harness base TUI extraction (#268, #271, [[harness-base-tui]]). The generic chat state (transcript, streaming, approvals) moves to harness; agent-specific state (file picker, palette, bash mode) stays here.

**286. `activeAgent` phantom in persisted state — DONE**
- File: `src/config.ts:18`, `src/main.ts`
- Dimension: Entity — Severity: P2
- Detail: Written by harness but never read in `main.ts`.
- Fix: `activeAgent` is now read by `bin/coding-agent.ts:132` to restore the active primary on startup. Not phantom.

**287. `AgentDisplay` duplicates `SubAgent` — REJECTED (intentional projection)**
- File: `src/main.ts:46`
- Dimension: Entity — Severity: P1
- Detail: `toDisplay` projects per call.
- Decision: Same as #275 — `AgentDisplay` is the UI's narrow view of `SubAgent`.

**288. `ChatLine` mixes data with UI components — REJECTED (transcript is transient)**
- File: `src/ui/Transcript.ts:11`
- Dimension: Entity — Severity: P1
- Detail: `output_block` carries a live `OutputBlock` instance. Breaks persisted/transient boundary.
- Decision: `Transcript` is a UI-only rendering buffer — persistence is `Session.messages` (mu-core) and `RoundtripStore` (harness). The boundary is already explicit; `output_block` (Bash output toggle) is rendering-only by design.

**289. `summariseMessage` phantom — DONE (already removed)**
- File: `src/ui/subAgentRun.ts:159`
- Dimension: Entity — Severity: P2
- Detail: Returns `''`, never called.
- Fix: See #281, #296 — already removed.

**290. `MainOptions` half-entity, half-callback bag — REJECTED (small interface, single consumer)**
- File: `src/main.ts:6-29`
- Dimension: Entity — Severity: P2
- Detail: Override/active primary trio could be `PrimaryAgentController` entity.
- Decision: `MainOptions` has one caller (`bin/coding-agent.ts`); extracting `PrimaryAgentController` would create a new entity for a single call site. Acceptable shape.

**291. `RoundtripStore` owns derived alongside source — REJECTED (cache shape, by design)**
- File: `src/ui/ChatApp.ts`
- Dimension: Entity — Severity: P2
- Detail: `contextText` (derived) held as sibling field.
- Decision: `contextText` is a frequently-rendered derived value; recomputing per frame from raw roundtrips would touch every part of every roundtrip on every render. The "cache + recompute on store change" pattern is the right shape.

**292. Missing entities — REFRAMED (harness base TUI)**
- Dimension: Entity — Severity: P1
- Detail: ChatViewState (or split: ToastState, ModalState, CommandPaletteState, FilePickerState, HistoryNavigator, OverrideAgentState), PrimaryAgentController, DeferredCommand, MentionRouting, SessionLifecycle.
- Decision: Same direction as #285 — the generic ones (ChatViewState, ToastState, ModalState, MentionRouting, SessionLifecycle) belong to the harness base TUI when extracted; the agent-specific ones (CommandPaletteState, FilePickerState) stay in coding-agent. Tracked with [[harness-base-tui]].

### Simplifications

**293. `ContextMap` entirely dead — DONE**
- File: `src/ui/components/ContextMap.ts`, `src/ui/ChatApp.ts:917, 1275-1279, 1566-1568`, `src/ui/Transcript.ts:12`
- Dimension: Simplification — Severity: P1
- Detail: `/context` command is commented out. Component (259 LOC) + `showContextMap()` + `role:'context'` branch + ChatLine union arm all unreachable.

**294. `STATUS_SLOTS` registry premature — DONE**
- File: `src/ui/statusSlots.ts:1-61`
- Dimension: Simplification — Severity: P1
- Detail: Only used by ChatApp with two trivial renderers. Inline `contextText` into `statusLine.ts`.

**295. `theme/index.ts` zero internal callers — DONE**
- File: `src/ui/theme/index.ts:1-2`
- Dimension: Simplification — Severity: P1
- Detail: Re-exports of `fgToAnsi`, `bgToAnsi`, `wrapWithStyle`, `ThemeSubscriber`, `ThemeColors`, `ThemeStyles` — zero callers.

**296. `subAgentRun.summariseMessage` dead — DONE**
- File: `src/ui/subAgentRun.ts:159-161`
- Dimension: Simplification — Severity: P1

**297. FilePicker back-compat exports unused — DONE**
- File: `src/ui/components/FilePicker.ts:18-19, 75-78, 122-125`
- Dimension: Simplification — Severity: P1
- Detail: `FilePickerEntry` alias, `invalidateTreeCache`, `fuzzyFilter` — zero callers.
- Fix: `FilePickerEntry` alias is also gone now (ChatApp stopped using it); all three back-compat exports removed.

**298. `CodingAgentConfig` provider fields — REJECTED (config-file compat)**
- File: `src/config.ts:8, 9, 11`
- Dimension: Simplification — Severity: P2
- Detail: `kind`, `baseUrl`, `provider` belong to local-provider config.
- Decision: These fields are written to users' `~/.config/mu/config.json` files; nesting them under `provider: { … }` would break every existing config silently. Worth doing only with a migration path; not a quick fix.

**299. `ModalMode` single-value union — DONE**
- File: `src/ui/ChatApp.ts:81`
- Dimension: Simplification — Severity: P2
- Detail: `type ModalMode = 'model'`. Collapse to boolean. `interceptModalInput` else-branch unreachable.

**300. `output_block` ChatLine arm one-off — REJECTED**
- File: `src/ui/Transcript.ts`
- Dimension: Simplification — Severity: P2
- Detail: Wraps OutputBlock component reference; pattern is one-off.
- Decision: Bash output is the only kind of collapsible-component-in-transcript today; the one-off arm is the minimal way to keep it. Generalizing would require modelling "embeddable transient component" as its own concept — no demand for that yet.

**301. `UserMessage` theme prop redundant — DONE**
- File: `src/ui/components/UserMessage.ts:9-15`
- Dimension: Simplification — Severity: P2
- Detail: `getTheme(ctx)` in body already handles live updates.

**302. `formatTokens.ts` 3 lines, one call site — DONE**
- File: `src/ui/formatTokens.ts`
- Dimension: Simplification — Severity: P2
- Detail: Inline.

---

## PACKAGE: mu-harness (`/home/gaetan-puleo/dev/mu/packages/harness`)

### Bugs

**303. Permissions glob dotall newline bypass — DONE**
- File: `src/permissions/glob.ts:18`
- Dimension: Bug — Severity: P1 (security)
- Detail: `RegExp(..., 's')` (dotAll) — `*` and `?` match `\n`. Rule `argsPattern: '*"command":"ls *'` matches `{"command":"ls\nrm -rf ~"}`. JSON-encoded tool args can carry literal newlines, defeating per-command bash policies.

**304. Approval decision not validated — DONE**
- File: `src/approvals/queue.ts:53-58`, `src/permissions/hook.ts:39`
- Dimension: Bug — Severity: P1
- Detail: `resolve(id, decision)` performs no validation. `userDecision === 'deny'` — any other string (typo, malicious transport, 'allow ', 'ALLOW') treated as allow.

**305. `persistOnBus` non-atomic write — DONE**
- File: `src/sessions/jsonl-store.ts:263`
- Dimension: Bug — Severity: P1
- Detail: Each event triggers `appendFileSync` + `store.touch()`. No locking, no rename-tmp; crash between JSON bytes and `\n` produces corrupt line that `readMessages` silently drops.

**306. `touch()` rewrites createdAt permanently — DONE**
- File: `src/sessions/jsonl-store.ts:222-231`
- Dimension: Bug — Severity: P2
- Detail: Non-atomic read-modify-write of meta. Transient meta-read failure + subsequent `touch` permanently rewrites `createdAt` to `Date.now()`.

**307. Session ID collision realistic — DONE**
- File: `src/sessions/jsonl-store.ts:151, 185`
- Dimension: Bug — Severity: P2
- Detail: ID = `Date.now().toString(36)_<6 random base36 chars>`. Same-ms collision in `create`/`fork` overwrites/appends to existing transcript (no `O_EXCL`).

**308. `waitForIdle` polls forever — DONE**
- File: `src/sub-agents/runner.ts:119`
- Dimension: Bug — Severity: P1
- Detail: Polls every 10ms forever with no abort signal/timeout. Parent's `subagent` tool call cancellation doesn't stop sub-agent — hang/leak.

**309. Only last error reported — DONE**
- File: `src/sub-agents/runner.ts:108`
- Dimension: Bug — Severity: P2
- Detail: `runError = event.error` overwrites on every error event.

**310. Parallel sub-agent approvals not attributable — DONE**
- File: `src/sub-agents/tool.ts:112-143`, `src/approvals/queue.ts:12`
- Dimension: Bug — Severity: P2
- Detail: `subagent_parallel` shares one `approvalPrompt` with N concurrent sub-agents. `ApprovalRequest` carries no agent name.

**311. Command registry alias-vs-name registration order — DONE**
- File: `src/commands/registry.ts:25-34`
- Dimension: Bug — Severity: P2
- Detail: Registering `{name: 'a', aliases: ['b']}` then `{name: 'b'}` is allowed. `resolve('b')` misroutes to `a` because alias lookup precedes name lookup.

**312. Plugin loader runs arbitrary code on boot — DONE**
- File: `src/plugin-loader.ts:58-71`
- Dimension: Bug — Severity: P1 (security)
- Detail: Any `.ts/.js/.mts/.mjs` file in `<dataDir>/plugins` is dynamically `import()`-ed on boot. Top-level side effects run before `validatePlugin`. No signature, no sandbox.
- Fix (two-layer defence):
  1. **Manifest gate** (#312 first pass): bare `.ts/.js` files are skipped; only a directory containing `plugin.manifest.json` + a manifest-referenced entrypoint loads. Entrypoint must stay inside the plugin dir (no `..` traversal, no absolute paths). Every load path is logged.
  2. **Trust-on-first-use (TOFU)** (this pass): `loadPlugins({ trustFile })` reads/writes `<configDir>/plugins-trust.json` mapping `"<name>@<version>" → sha-256(entrypoint)`. First load records the hash; subsequent loads must match. Mismatch refuses the load before any `import()` runs. Trust file lives in `configDir`, separate from `pluginsDir`, so an attacker who can only write the plugins dir can't forge entries. Bootstrap wires it via `paths.pluginsTrustFile` (new `XdgPaths` field).
  - Test coverage (5 new tests): TOFU record on first load, hash-match on subsequent, refuse-on-tamper, malformed-trust-file recovery, manifest-gate × trust orthogonality.
  - Full Worker/vm sandbox is a separate feature, not security parity. The current state defeats drive-by drops AND post-install tampering.

**313. Unanchored npm spec regex — DONE**
- File: `src/plugin-loader.ts:50-52`
- Dimension: Bug — Severity: P2
- Detail: `isAllowedSpec` regex `/^@[\w-]+\/[\w.-]+/` is not anchored. `npm:` branch accepts any string starting with `npm:`.

**314. Scheduler crash on bad cron — DONE**
- File: `src/scheduler/plugin.ts:48-50, 66`
- Dimension: Bug — Severity: P2
- Detail: `new Cron(task.cron, ...)` throws synchronously on invalid cron strings; no try/catch around `scheduleTask`. One malformed line kills scheduler start.

**315. Cron-fired prompts have no provenance — DONE**
- File: `src/scheduler/plugin.ts:70`
- Dimension: Bug — Severity: P2 (security)
- Detail: Scheduled tasks publish `user_message` directly. Permission rules can't distinguish "user typed this" from "cron fired".
- Fix: mu-core's `CoreEvent` variants (`user_message`, `steer`, `follow_up`, `queued_message`) now carry an optional `source?: MessageSource` field (`'user' | 'cron' | 'rpc' | 'agent' | string`). The scheduler now publishes with `source: 'cron'`. `MessageSource` is exported from mu-core so the permission hook (or any consumer) can refuse risky auto-actions.

**316. Channel manager caches half-started channel — DONE**
- File: `src/channels/manager.ts:33-42`
- Dimension: Bug — Severity: P2
- Detail: `channels.set` before awaiting `channel.start`. If `start` rejects, manager keeps the half-started channel; later `remove`/`stopAll` calls `stop` on a never-started channel.

**317. Mention engine no escape mechanism — DONE**
- File: `src/mentions/engine.ts:8`
- Dimension: Bug — Severity: P2
- Detail: Regex allows mentions inside arbitrary strings (code blocks, tool results). Resolvers run on `@prefix:target` in unexpected places.

### Architecture

**318. 11 subfolders; many with no in-repo consumer — DONE**
- File: `src/`
- Dimension: Architecture — Severity: P1
- Detail: `channels/`, `mentions/`, `scheduler/`, `roundtrips.ts` have zero consumers outside the harness package.

**319. `bootstrap()` not called by coding-agent — DONE (bootstrap is now called; verified in c301551 + 97e1d6e)**
- File: `src/bootstrap.ts`
- Dimension: Architecture — Severity: P1
- Detail: 300-line orchestrator with no caller in this monorepo (coding-agent uses pieces individually).
- Direction: harness is the intended base for channels/mentions/scheduler AND the base chat TUI. Port coding-agent onto `bootstrap()` rather than treat the orphan status as evidence to delete. Bootstrap should also wire the base TUI that both coding-agent and arya extend. See [[feedback-harness-role]], [[harness-base-tui]].

**320. `channels/tui.ts` reimplements slash detection — DEFERRED (harness base TUI)**
- File: `src/channels/tui.ts:62-66`, `src/commands/registry.ts:51-55`
- Dimension: Architecture — Severity: P2
- Detail: Both own slash-detection logic.
- Direction: dedupe internally in harness; coding-agent should consume the Channel-side slash detection rather than building its own. See [[feedback-harness-role]].

**321. `bootstrap.ts` is 300-line god function — DONE**
- File: `src/bootstrap.ts`
- Dimension: Architecture — Severity: P1
- Detail: 11 numbered steps. Steps 4-5 (permissions+approvals+hook) and 9 (tools+subagent injection) deserve dedicated factories.

**322. Sub-agent runner re-spins runtime — REJECTED (different purpose)**
- File: `src/sub-agents/runner.ts:82-92`
- Dimension: Architecture — Severity: P2
- Detail: Calls `createBus`, `createInMemorySessionStore`, `createRuntime` directly instead of using `createAgentRuntime`. Two runtime construction paths.
- Decision: `createAgentRuntime` adds Model state + model-change callbacks for the primary agent's lifetime. Sub-agent runs are transient and don't have a model picker — using `createAgentRuntime` would force them through code paths they don't need (model state, listModels, onModelChange). The direct path is the minimal correct shape.

**323. Two session-store contracts side-by-side — REJECTED (extension by design)**
- File: `src/sessions/types.ts`, `src/bootstrap.ts:111`
- Dimension: Architecture — Severity: P2
- Detail: mu-core's `SessionStore` and harness's `PersistedSessionStore` extension. Bootstrap returns base type even when persistent — requires downcast.
- Decision: The split mirrors capability tiers — core's `SessionStore` is the minimal contract; `PersistedSessionStore` extends with file-system-only ops (`summarise`, `watch`, `rename`). Hosts wanting persistence opt into the wider type. Returning the base from bootstrap keeps callers that don't need persistence loosely coupled.

**324. Public API flat (50+ symbols) — DONE**
- File: `src/index.ts`
- Dimension: Architecture — Severity: P1
- Detail: Mandatory wiring next to optional utilities next to not-yet-used scaffolding.
- Fix: `src/index.ts` now uses section comment headers grouping by subsystem (paths/approvals/permissions/skills/sub-agents/mentions/channels/sessions/scheduler/plugins). Commands subsystem de-exported (#370). The flat shape is intentional — section barrels would add a layer for tree-shake-friendly imports.

**325. No package-level re-export grouping — REJECTED (intentional)**
- File: `src/index.ts`
- Dimension: Architecture — Severity: P2
- Detail: All exports inlined; subfolders don't have own barrels.
- Decision: Subfolder barrels would re-export everything, defeating tree-shaking. The top-level `index.ts` is the single public surface; section headers group logically. See #324.

### Responsibilities

**326. Coherent core — INFO (positive observation, no action)**
- File: `src/`
- Dimension: Responsibilities — Severity: (info)
- Detail: bootstrap+permissions+approvals+skills+sub-agents+sessions+plugin-loader work together; permissions↔approvals coupling justifies bundling.

**327. `channels/mentions/scheduler/` should move out — REJECTED**
- File: `src/channels/`, `src/mentions/`, `src/scheduler/`
- Dimension: Responsibilities — Severity: P1
- Detail: Zero in-repo consumers; arya bypasses channels with its own WS layer.
- Decision: KEEP in harness. These are the intended shared base for both coding-agent and arya. The lack of consumers is the wiring gap to close (#319, #320, #322, #409), not evidence of dead code. See [[feedback-harness-role]].

**328. `plugins/installer.ts` could move — REJECTED**
- File: `src/plugins/installer.ts`
- Dimension: Responsibilities — Severity: P2
- Detail: Install-time CLI helper, not runtime orchestration. Better in `mu-cli` or coding-agent.
- Decision: The installer enforces the `plugin-loader`'s trust model (allowed-spec regex, dir layout); moving it out of harness would split a single security concern across packages. Harness is the right home.

**329. `bootstrap()` boundary undocumented — DONE**
- File: `src/bootstrap.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: Decide: port coding-agent onto it OR delete the orchestrator.
- Fix: Coding-agent now calls `bootstrap()` (#319). The file's top doc-comment ("Cross-host bootstrap helper") spells out what it owns and what the host still owns.

**330. No tests for bootstrap — DONE**
- File: `src/bootstrap.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: 300-line orchestrator, untested.
- Fix: Added `bootstrap.test.ts` — 9 tests covering empty defaults, single-primary loading, primary/sub-agent split, lone-agent fallback, dynamic/static toolFilter modes, extra-plugin composition, subagent dispatcher injection, and the in-memory session store wiring.

### Types

**331. PermissionRule single glob — REJECTED (sufficient surface)**
- File: `src/permissions/types.ts:11`
- Dimension: Types — Severity: P1
- Detail: `argsPattern?: string` — args is a single glob over `JSON.stringify(args)`. No structured rule shape (path, env, host).
- Decision: A structured rule (path/env/host) imposes a schema on permission writers — today users write `{ tool: 'bash', argsPattern: '*git *' }` in JSON and it just works. Per-tool schemas are a tool-author concern (#142); permission rules are operator concern.

**332. `PermissionCheck.args: string` — REJECTED**
- File: `src/permissions/types.ts:22`
- Dimension: Types — Severity: P2
- Detail: Stringified blob.
- Decision: Permission rules glob-match against the stringified args (matches what arrives on the wire). Parsing would conflict with rules like `*"command":"ls *` that pattern across the raw JSON shape.

**333. `PermissionPrompt`/`ApprovalDecision` mismatch — REJECTED**
- File: `src/permissions/hook.ts:10`, `src/approvals/queue.ts:20`
- Dimension: Types — Severity: P2
- Detail: Bare literals vs named alias.
- Decision: The bare literals at the prompt-callback boundary keep the function signature compact and self-documenting; `ApprovalDecision` is the named alias used inside the queue. They overlap in values but not in concept (prompt callback vs queue state).

**334. `ApprovalRequest.id: unbranded string` — REJECTED**
- File: `src/approvals/queue.ts:13`
- Dimension: Types — Severity: P1
- Detail: Should be `ApprovalRequestId` (branded).
- Decision: IDs flow approval-queue → bus → UI → user-typed response → queue.resolve. Branding would force conversions at every transport hop (WS payload, JSON, user input). Value-add is preventing "mixing approval id with session id", which has never collided in practice. Cost > benefit for harness-wide ID branding.

**335. `parseArgs` silent fallback — DONE**
- File: `src/sub-agents/tool.ts:42, 149, 161`
- Dimension: Types — Severity: P2
- Detail: Falls back to `{ agent: '', task: '' }` on JSON.parse failure.

**336. `SubAgentRunResult.error?` sentinel — DONE**
- File: `src/sub-agents/runner.ts:58`
- Dimension: Types — Severity: P1
- Detail: Should be discriminated union `{ status: 'ok', content } | { status: 'failed', error, partialContent? }`.
- Fix: Now a discriminated union `{ status: 'ok', agentName, content } | { status: 'failed', agentName, content, error, errors }`. Callers narrow via `result.status === 'failed'`.

**337. Channel error: unknown too wide — REJECTED**
- File: `src/channels/types.ts`
- Dimension: Types — Severity: P2
- Detail: Renderers can't dispatch on it.
- Decision: Channels relay arbitrary errors from arbitrary providers/tools; constraining the shape would force every error to a single discriminator. Renderers consume the message text (the human-facing form); structured dispatch is a future enhancement that needs an error taxonomy first.

**338. `Channel.kind: string` — DONE**
- File: `src/channels/types.ts:38`
- Dimension: Types — Severity: P2
- Detail: Should be string-literal-extensible union.
- Fix: Added `ChannelKind = 'tui' | 'ws' | 'telegram' | 'slack' | 'rpc' | (string & {})` — literal autocomplete + extensible.

**339. `Command<TArgs,TCtx>` generics lost — REJECTED (commands de-exported)**
- File: `src/commands/types.ts:21-23`
- Dimension: Types — Severity: P1
- Detail: `parseArgs?: (raw: string) => unknown` then `run: (args: unknown, ctx: Record<string, unknown>) => …`.
- Decision: Commands subsystem de-exported (#370); internal callers don't pass generics. Public API has no consumer that would benefit.

**340. `CommandResult.output?: unknown` — REJECTED (commands de-exported)**
- File: `src/commands/types.ts:3`
- Dimension: Types — Severity: P2
- Detail: Forces every TUI renderer to coerce via `String(...)`.
- Decision: Same as #339 — internal.

**341. `MentionResolver` not generic — REJECTED**
- File: `src/mentions/types.ts:6, 17`
- Dimension: Types — Severity: P2
- Detail: `payload?: unknown` and `ctx: Record<string, unknown>`.
- Decision: Mention resolvers are pluggable with arbitrary payload shapes per kind (`@user:`, `@file:`, etc.); typing the resolver generically would force every host to pre-declare every mention kind. The `unknown` boundary is correct for a registry of heterogeneous resolvers.

**342. Session ids unbranded — REJECTED (same as #334)**
- File: `src/sessions/types.ts:5-11`
- Dimension: Types — Severity: P1
- Detail: No `SessionId` brand to prevent mixing with `AgentId`/`RoundtripId`.
- Decision: Same scope as #334. Brand-everywhere is a large, coordinated change with low practical safety win; today no ID-mixing bug has materialized.

**343. `as Message` / `as Meta` casts — REJECTED (trust boundary is on write)**
- File: `src/sessions/jsonl-store.ts:50, 61`
- Dimension: Types — Severity: P1
- Detail: `JSON.parse(line) as Message` — no validation.
- Decision: The harness writes the JSONL files itself (transcripts are append-only by the runtime). Validating on read would only catch user manual edits — and at that point the user has already opened the file. The current malformed-line `catch` + console.error covers torn-write recovery.

**344. SchedulerTask weak strings — REJECTED**
- File: `src/scheduler/plugin.ts:23-29`
- Dimension: Types — Severity: P2
- Detail: `cron: string`, `timezone?: string`, `id: string`, `channel?: string`.
- Decision: cron syntax and timezone IDs are well-known external standards; baking validation types is library-of-strings territory. Runtime validation via `new Cron(...)` is the right boundary.

**345. `validatePlugin` uses `as` after duck-typing — REJECTED (RPC trust boundary)**
- File: `src/plugin-loader.ts:25`
- Dimension: Types — Severity: P1
- Detail: No manifest type. Returns `Plugin` via cast.
- Decision: Plugins are arbitrary JS modules — even with a manifest type, the runtime can't statically verify the loaded module matches it. The duck-test (`typeof name === 'string' && (tools or provider exists)`) is the correct dynamic boundary; the cast just satisfies TS after the check.

**346. Frontmatter freeform — REJECTED**
- File: `src/markdown.ts:5`
- Dimension: Types — Severity: P2
- Detail: `Record<string, unknown>` — every consumer hand-rolls validation.
- Decision: The parser is generic — it returns whatever YAML is in the frontmatter. Consumers (sub-agent loader, skill loader) each have their own required fields and validate them. Pre-typing the parser would force a single schema.

**347. `Model.id: unbranded string` — REJECTED (same as #334)**
- File: `src/agent-runtime.ts:14-19`
- Dimension: Types — Severity: P1
- Detail: Should be `ModelId` (used through commands, runtime, listModels).
- Decision: Same as #334 — brand-everything is high-effort, low-yield.

**348. Runtime inferred shape leaks — REJECTED**
- File: `src/agent-runtime.ts:23`
- Dimension: Types — Severity: P2
- Detail: `runtime: ReturnType<typeof createCoreRuntime>` exposes inferred shape.
- Decision: `ReturnType<typeof createCoreRuntime>` resolves to mu-core's exported `Runtime` type — they're equivalent. The `ReturnType` form survives if `Runtime` is ever re-shaped without re-exporting.

**349. `extraCommands` couples tightly — DONE**
- File: `src/bootstrap.ts:92`
- Dimension: Types — Severity: P2
- Detail: `extraCommands?: ReturnType<CommandRegistry['list']>` obscures contract.
- Fix: `extraCommands` was removed when commands subsystem was de-exported (#370, #372).

**350. Roundtrip index unbranded — REJECTED**
- File: `src/roundtrips.ts:3`
- Dimension: Types — Severity: P2
- Detail: Could be `RoundtripIndex`.
- Decision: Same as #334 — branding policy applied consistently across the package.

**351. Missing branded id types — REJECTED (consistent decision)**
- Dimension: Types — Severity: P1
- Detail: AgentId, SessionId, ModelId, TaskId, RoundtripIndex, ChannelId — none branded.
- Decision: Same as #334/#342/#347/#350 — branding is a coordinated cross-package change with low practical safety win. Revisit if an ID-mixing bug actually surfaces.

### Entities

**352. `SubAgent` conflates roles — REJECTED (one entity, two uses)**
- File: `src/sub-agents/types.ts:3`, `src/bootstrap.ts:164-167`
- Dimension: Entity — Severity: P1
- Detail: One shape carries primary persona that drives root runtime AND delegatable worker via `subagent` tool. Discriminator field `type` is the only differentiator.
- Decision: They share the same disk shape (frontmatter + body), load from the same directory, and have the same field set (name, prompt, tools, permissions). The `type` discriminator is the *intended* fork — splitting into two types would force the loader, registry, and every consumer to handle two shapes that differ in one field.

**353. No stable ids (name is primary key) — REJECTED**
- File: `src/sub-agents/loader.ts:28`, `src/commands/registry.ts:25`
- Dimension: Entity — Severity: P2
- Detail: SubAgent, Skill, Command, Channel, MentionResolver all use `name`. No separate `id`.
- Decision: Name IS the primary key by design — users reference agents/skills/commands by name in YAML/permissions/CLI. A separate `id` would force a lookup table and add a layer users don't want.

**354. `AgentRuntime` thin wrapper — REJECTED**
- File: `src/agent-runtime.ts:21`
- Dimension: Entity — Severity: P2
- Detail: Adds Model state + re-create function around core `Runtime`. Not a domain entity. Rename `SessionManager` or fold into bootstrap.
- Decision: It bundles bus + runtime + store + model state into one object that hosts pass around. Renaming to `SessionManager` doesn't fit (it's not just sessions); folding into bootstrap would inline 60 lines into the orchestrator that wires it. Keep.

**355. `HostConfig` anaemic — DONE**
- File: `src/host-config.ts:10`
- Dimension: Entity — Severity: P2
- Detail: 4 string arrays + a name. Used once in bootstrap.
- Fix: `host-config.ts` was removed entirely (#267, #380).

**356. `Roundtrip` lifecycle unclear — REJECTED (acceptable scope)**
- File: `src/roundtrips.ts:3, 18`
- Dimension: Entity — Severity: P2
- Detail: In memory only, no link to Session/transcript. Relationship to core's `LLMResponseContext` unwritten.
- Decision: `RoundtripStore` is the in-memory aggregation of `LLMResponseContext` over a session — its sole consumer is the `/context` view in coding-agent. Persistence (cross-session history) isn't needed because the view is "this session's roundtrips". Linking to messages would couple it to the session entity for no consumer benefit.

**357. `ApprovalRequest` lacks context — DONE**
- File: `src/approvals/queue.ts:12`
- Dimension: Entity — Severity: P1
- Detail: No session id, no requesting agent name, no channel — makes multi-channel/multi-session approval routing hard.
- Fix: `ApprovalRequest` now carries `agent?`, `sessionId?`, `channelId?` — all populated from `ApprovalRequestMeta` (also enriched). Same fields added to `PermissionPromptMeta`. Hosts that don't route by session/channel can omit; multi-runtime hosts (arya per WS client) can populate.

**358. `SchedulerTask.channel` dangling — REJECTED**
- File: `src/scheduler/plugin.ts:28, 70`
- Dimension: Entity — Severity: P2
- Detail: Field exists but no Channel coupling.
- Decision: `channel` is forwarded into the published `user_message` so downstream code (handler, channel router) can dispatch. The scheduler doesn't need to know about Channel; hosts wire the two together.

**359. `Mention` not an entity — REJECTED**
- File: `src/mentions/`
- Dimension: Entity — Severity: P2
- Detail: Only `ResolvedMention` exists.
- Decision: An unresolved mention is just `{prefix, target}` — modelled inline in the regex match. Lifting to an entity would create a 2-field type used in one place.

**360. Missing registries/gateways — REJECTED (arrays are sufficient)**
- File: `src/`
- Dimension: Entity — Severity: P1
- Detail: SkillRegistry, SubAgentRegistry (skills/subagents are flat arrays), ApprovalGateway/PermissionGateway (wiring rebuilt twice in bootstrap + runner), PluginRegistry.
- Decision: Skills/sub-agents are loaded once at boot from disk and never mutated — a flat array is the right shape. Registries pay off when you have insert/remove/lookup at runtime; we don't. ApprovalQueue + PermissionRegistry already exist (those are the gateways).

**361. AgentDefinition concept missing — REJECTED (SubAgent is the definition)**
- Dimension: Entity — Severity: P1
- Detail: Mentioned in repo context but absent; `SubAgent` plays both roles.
- Decision: `SubAgent` IS the agent definition — disk-loaded markdown + frontmatter. Naming it `AgentDefinition` would just rename; the structure is correct. See #352.

**362. Channel session binding missing — REJECTED (premature)**
- File: `src/channels/`
- Dimension: Entity — Severity: P2
- Detail: No `ChannelSession` linking channelId ↔ sessionId. Hosts re-invent it.
- Decision: Single-channel-per-process today; the binding is implicit. When multi-channel arrives (e.g. arya routing telegram + WS to one runtime), add `ChannelSession`. Until then it's empty ceremony.

**363. Phantom: parser inputs near-identical — REJECTED (same shape, different validation)**
- File: `src/sub-agents/`, `src/skills/`
- Dimension: Entity — Severity: P2
- Detail: `SubAgentParseInput`, `SkillParseInput` almost identical.
- Decision: Both wrap "loaded markdown" but the validation diverges (sub-agent requires `name`+`type`, skill requires `name`+`description`). Sharing a parse input would force consumers to recheck what the other parser already verified.

**364. `SubAgentToolDeps` missing entity — REJECTED (getter pattern is intentional)**
- File: `src/sub-agents/tool.ts:6`
- Dimension: Entity — Severity: P2
- Detail: Getter-bag with five `get*` closures — missing `AgentDispatcher` entity.
- Decision: Getters are how the tool reads live mutable state from its host (the host swaps active primary, tools, plugins at runtime). An `AgentDispatcher` entity that holds these would re-introduce the mutable-state problem inside a wrapper.

### Simplifications

**365. Delete `channels/` entirely — REJECTED**
- File: `src/channels/`
- Dimension: Simplification — Severity: P1
- Detail: ~400 LOC. No external imports. `channels/types.ts`, `manager.ts`, `tui.ts` plus tests.
- Decision: KEEP. Channels are the intended shared abstraction for coding-agent (TUI) and arya (WS). Action is to wire consumers, not delete. See [[feedback-harness-role]].

**366. Delete `mentions/` entirely — REJECTED**
- File: `src/mentions/`
- Dimension: Simplification — Severity: P1
- Detail: No consumers outside its own test.
- Decision: KEEP. Mentions are the intended shared mechanism — coding-agent and arya should both consume it. See [[feedback-harness-role]].

**367. Delete `scheduler/` entirely — REJECTED**
- File: `src/scheduler/plugin.ts:1-116`
- Dimension: Simplification — Severity: P1
- Detail: No in-repo consumer; pulls `croner` + `@std/yaml`. Only `SchedulerEvent` referenced from index.
- Decision: KEEP in harness. Scheduler is foundational; consumers (coding-agent, arya) should plug into it rather than the package fragmenting. See [[feedback-harness-role]].

**368. Delete `logger.ts` — DONE**
- File: `src/logger.ts:1-56`
- Dimension: Simplification — Severity: P1
- Detail: No external consumer.

**369. Delete `paths/env.ts` — DONE**
- File: `src/paths/env.ts`
- Dimension: Simplification — Severity: P1
- Detail: `loadEnvFile`/`maskEnvValue` exported, no consumer.

**370. Delete commands subsystem — DONE**
- File: `src/commands/`
- Dimension: Simplification — Severity: P1
- Detail: Coding-agent never accesses `result.commandRegistry`. Drop `extraCommands`/`skipDefaultCommands`/`commandRegistry` from bootstrap.
- Fix: Entire `src/commands/` directory deleted — registry, types, defaults, tests. Zero consumers anywhere (coding-agent has its own slash-command system in `src/ui/chatApp/commands.ts`). Net −13 test steps; the registry can be re-introduced when a second consumer (e.g. arya's TUI) actually needs a shared command vocabulary.

**371. Bootstrap dead fields — DONE**
- File: `src/bootstrap.ts:106-122`
- Dimension: Simplification — Severity: P1
- Detail: `hostName`, `paths`, `hostConfig`, `envResult`, `permissionConfig`, `commandRegistry`, `skills` never read.

**372. Bootstrap dead options — DONE**
- File: `src/bootstrap.ts`
- Dimension: Simplification — Severity: P2
- Detail: `permissionSource`, `extraCommands`, `skipDefaultCommands`, `paths` override, `extraPermissionsFiles`, `extraPluginsDirs`.

**373. Bootstrap env loading unused — DONE**
- File: `src/bootstrap.ts:142`
- Dimension: Simplification — Severity: P1
- Detail: `EnvFile` loading happens but caller never inspects `envResult`.

**374. `sessions/jsonl-store.ts` not used by coding-agent — INVALID**
- File: `src/sessions/jsonl-store.ts`
- Dimension: Simplification — Severity: P1
- Detail: 285 lines. Coding-agent passes `sessionStore: 'memory'`. Either remove or move out.
- Note: Stale finding — coding-agent now calls `createJsonlSessionStore(paths.sessionsDir)` directly (`bin/coding-agent.ts:103`). The jsonl store IS in use.

**375. Permission internals reexported unnecessarily — DONE**
- File: `src/index.ts:31-46`
- Dimension: Simplification — Severity: P2
- Detail: `compileGlob`, `matchTool`, `matchArgs`, `loadPermissions`, etc. — only consumed inside the package.

**376. Markdown/skills/sub-agents internals reexported — DONE**
- File: `src/index.ts:48-65`
- Dimension: Simplification — Severity: P2
- Detail: `parseFrontmatter`, `parseSkill`, `loadSkills`, etc. — internal-only.

**377. `plugin-loader` options reexported — DONE**
- File: `src/index.ts`
- Dimension: Simplification — Severity: P2
- Detail: `LoadPluginsOptions` / `loadPlugins` exported but only used internally.

**378. CommandRegistry alias map unused — DONE (commands de-exported)**
- File: `src/commands/registry.ts:16, 28-34, 41`
- Dimension: Simplification — Severity: P2
- Detail: No command in the repo defines aliases.
- Fix: Commands subsystem is internal (#370); the alias map only matters to external consumers.

**379. `AgentRuntime` over-exposed — DONE**
- File: `src/agent-runtime.ts:62-113`
- Dimension: Simplification — Severity: P2
- Detail: Coding-agent uses 7 of 12 properties. `createRuntime(sessionId)`, `currentSession()`, `listModels`, `models` array, `model` getter, `onModelChange` can collapse.

**380. `HostConfig` wrapper unnecessary — DONE**
- File: `src/host-config.ts`
- Dimension: Simplification — Severity: P2
- Detail: 26-line wrapper around 4 string-arrays. Collapse to plain interface.

**381. Bootstrap static branching dead — REJECTED (arya uses it)**
- File: `src/bootstrap.ts:167-264`
- Dimension: Simplification — Severity: P2
- Detail: Static path for hosts that don't pass `getActivePrimary`; coding-agent always passes one.
- Decision: Arya (separate repo) uses the static path — it manages a single primary across the WS connection lifetime, no Tab-cycling. Keep both branches.

**382. `approvalQueueToPrompt` one-liner — REJECTED**
- File: `src/approvals/`
- Dimension: Simplification — Severity: P2
- Detail: `queue.request(call.tool, call.args, matched)`. Inline.
- Decision: Named function makes the adapter `ApprovalQueue → PermissionPrompt` explicit at the call site (`bin/coding-agent.ts`, sub-agent runner). Inlining hides the type seam.

**383. `XdgPaths` over-declared — DONE**
- File: `src/paths/xdg.ts`
- Dimension: Simplification — Severity: P2
- Detail: Declares 18 path fields; coding-agent reads `pluginsDir`, `agentsDir`, `skillsDir`, `permissionsFile`.

**384. Subagent parser tool-arg shapes — REJECTED (LLM-friendly)**
- File: `src/sub-agents/parser.ts:74-127`
- Dimension: Simplification — Severity: P2
- Detail: Array + comma-string + object forms; pick one.
- Decision: LLMs reliably emit `tools: read,write` (string), `tools: [read, write]` (array), or `tools: {…}` (object). Accepting all three is more forgiving than forcing a single form; the parser normalizes once.

**385. Dual primary-pick heuristic — REJECTED (UX convenience)**
- File: `src/sub-agents/primary.ts:14-18`
- Dimension: Simplification — Severity: P2
- Detail: "Exactly one agent → it's primary" fallback adds magic. Require `type: primary`.</br>
- Decision: The fallback removes a foot-gun for first-time users (define one agent → it just works). The "magic" is bounded: only triggers when zero `type: primary` are declared AND exactly one agent exists.

**386. Package shrinks 4344 → ~1500 LOC — REJECTED**
- File: package overall
- Dimension: Simplification — Severity: P1
- Detail: 11 subfolders → 3-4 (sub-agents, permissions, skills, sub-agents, sessions, plugin-loader).
- Decision: target retracted. Channels/mentions/scheduler stay, so the shrink premise no longer holds. The package may still slim via other dead-code cleanup (logger, env, etc. already done) but not via removing the shared base. See [[feedback-harness-role]].

---

## PACKAGE: arya server (`/home/gaetan-puleo/dev/arya-agent/packages/arya`)

### Bugs

**387. Scheduler/ws ordering issue — DONE**
- File: `src/bootstrap.ts:130-149`
- Dimension: Bug — Severity: P1
- Detail: `createSchedulerPlugin({ onEvent: (event) => ws.push(...) })` constructed on line 130; `ws` declared on line 149. Scheduler is pushed into `result.plugins` AFTER `createAgentRuntime` already snapshotted.
- Impact: Scheduler may not be installed in runtime.

**388. Empty authToken disables auth — DONE**
- File: `src/init.ts:16-26`, `src/bootstrap.ts:151,244`, `src/ws.ts:244`
- Dimension: Bug — Severity: P1
- Detail: Template writes `authToken: ''`. `if (opts.authToken && token !== opts.authToken)` — empty string is falsy, so any client (no token at all) is accepted.
- Impact: Fresh installs ship wide-open.

**389. WebSocketServer binds to all interfaces — DONE**
- File: `src/ws.ts:279`
- Dimension: Bug — Severity: P1
- Detail: `WebSocketServer({ port })` no `host` option → reachable on LAN. Combined with empty token: anyone on network can drive the agent and approve tool calls.

**390. `stop()` doesn't await `wss.close()` — DONE**
- File: `src/ws.ts:296-308`
- Dimension: Bug — Severity: P2
- Detail: `wss?.close()` fire-and-forget. Returns before server releases port.

**391. `watchForIdle` interval leaks — DONE**
- File: `src/ws.ts:225-230`
- Dimension: Bug — Severity: P2
- Detail: `setInterval` cleared only when `runtime.state() === 'idle'`. If session switched mid-turn (`teardownActive` → `runtime.stop()`), interval polls stopped runtime forever.

**392. Approval response no ownership check — DONE**
- File: `src/ws.ts:176-182`
- Dimension: Bug — Severity: P2
- Detail: Any connected client can `approval_response` any `requestId`. No check that requestId belongs to current session or that client originated tool call.

**393. Approval replay stamped wrong session — DONE**
- File: `src/ws.ts:255-264`
- Dimension: Bug — Severity: P2
- Detail: Pending approvals re-broadcast on reconnect with `sessionId: activeSessionId`, even if raised under different session.

**394. No message size cap — DONE**
- File: `src/ws.ts:266-272`
- Dimension: Bug — Severity: P2
- Detail: `ws` library default `maxPayload` is 100 MiB. Oversized message OOMs.

**395. No port validation — DONE**
- File: `src/bootstrap.ts:41-72`
- Dimension: Bug — Severity: P2
- Detail: `loadConfig` doesn't validate `wsPort`. Accepts string, 0, negative.

**396. `sessions:delete` doesn't notify client — DONE**
- File: `src/ws.ts:189-199`
- Dimension: Bug — Severity: P2
- Detail: If deleted session was active, `teardownActive()` runs but client never gets signal; next `chat` creates fresh session under same `defaultSessionId`.

**397. SIGINT not idempotent — DONE**
- File: `src/index.ts:81-90`
- Dimension: Bug — Severity: P2
- Detail: Second SIGINT during shutdown re-enters `handle.shutdown()` concurrently. No timeout/force-exit.

### Architecture

**398. 4 files, ~700 LOC — DEFERRED (arya-agent repo)**
- File: `src/`
- Dimension: Architecture — Severity: (info)
- Detail: Thin composition layer.

**399. README/PLAN drift — DONE**
- File: README.md, PLAN.md
- Dimension: Architecture — Severity: P1
- Detail: Parent README lists `ws-channel.ts`, `scheduler.ts`, `plugins/tools/{fs,shell,http}` — none exist in `src/`.

**400. Actually uses mu-tools + mu-webfetch — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts:18-19, 96, 105`
- Dimension: Architecture — Severity: (info)
- Detail: fs/shell from `mu-tools`; http from `mu-webfetch`; scheduler from `mu-harness`.

**401. Layering sound — DEFERRED (arya-agent repo)**
- File: All
- Dimension: Architecture — Severity: (info)
- Detail: bin → index (CLI) → bootstrap (composition) → {harness orchestration, ws transport}.

**402. Zero tests — DEFERRED (arya-agent repo)**
- File: package
- Dimension: Architecture — Severity: P1
- Detail: `find` returns no test files.

**403. Scheduler post-attach undocumented — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts:130-135`
- Dimension: Architecture — Severity: P2
- Detail: Pushed onto `result.plugins` after `harnessBootstrap` returns, before `createAgentRuntime`. Load-bearing but undocumented.

**404. Transport coupling leak — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:46-49`
- Dimension: Architecture — Severity: P2
- Detail: `asPersistedStore` cast admits `AgentRuntime.store` is typed loosely.

**405. Public API hidden — DEFERRED (arya-agent repo)**
- File: package.json
- Dimension: Architecture — Severity: P2
- Detail: `bin` only — no `main`, no `exports`, no type publishing.

**406. `setInterval` idle-poll — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:224-231`
- Dimension: Architecture — Severity: P2
- Detail: Should be event-driven from bus.

### Responsibilities

**407. arya correctly thin (no tool duplication) — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts:18-19`
- Dimension: Responsibilities — Severity: (info)
- Detail: Premise about duplicated fs/shell/http was wrong.

**408. README stale on `createAryaToolsPlugin` — DONE**
- File: README.md
- Dimension: Responsibilities — Severity: P1
- Detail: Mentions `createAryaToolsPlugin (fs, shell, http)` — doesn't exist in code.

**409. ws.ts bypasses Channel abstraction — DONE (converted to WsChannel via createChannelManager)**
- File: `src/ws.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: Re-implements bus→client bridging, session activation, approval surfacing inline. Should be a `WsChannel` registered via `createChannelManager`.
- Direction: this is the canonical example of the wiring direction. Converting `ws.ts` to a Channel implementation removes the WS-protocol drift between arya and companion (#418, #467) and the need for a shared protocol package (#455). See [[feedback-harness-role]].

**410. Mobile protocol envelope arya-specific — DEFERRED (arya-agent repo)**
- File: `src/ws.ts`
- Dimension: Responsibilities — Severity: (info)
- Detail: sessions:list/create/delete/rename/get, approval token shape — product-specific.

### Types

**411. Server essentially untyped at wire boundary — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:43,65,71,313`
- Dimension: Types — Severity: P1
- Detail: Every outbound payload is `Record<string, unknown>`.

**412. Inbound parsed loosely — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:137-143`
- Dimension: Types — Severity: P1
- Detail: `Record<string, unknown>`, then `String(msg.type ?? '')`, `String(msg.text ?? '')`. No validation.

**413. `asPersistedStore` structural cast — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:46-49`
- Dimension: Types — Severity: P2
- Detail: Gated only by code comment ("safe by construction").

**414. Bus event Parameters<...> trick — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:106`
- Dimension: Types — Severity: P2
- Detail: `Parameters<Parameters<typeof bus.subscribe>[0]>[0]`. Harness doesn't export `CoreEvent`/`BusEvent`.

**415. Approval action bare string — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:177-179`
- Dimension: Types — Severity: P1
- Detail: Only `'approve' | 'approve_always'` map to allow.

**416. Config hand-cast — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts:42, 61-71`
- Dimension: Types — Severity: P1
- Detail: `Partial<BootstrapConfig>` + `result.baseUrl as string` after manual `missing[]` check. No schema.

**417. Scheduler event shape unknown — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts:133`
- Dimension: Types — Severity: P2
- Detail: Emits `{ type: 'scheduler_event', event }` where `event` is `unknown`-shaped.

**418. Wire types duplicated, drifting — DEFERRED (arya-agent repo)**
- File: `src/ws.ts` vs `arya-companion/src/types/wire.ts`
- Dimension: Types — Severity: P1
- Detail: Companion has strict discriminated union; server has no shared types. Drift: server emits `activity` (not in companion union); companion expects `turn_start`/`active_agent`/`set_active_agent`/`sub_agent_event`/`scheduler_event`.
- Direction: resolved by #409 — once arya's WS is a harness Channel, the wire shape is defined once in harness, not duplicated on both sides. See [[feedback-harness-role]].

### Entities

**419. No `WebSocketSession` entity — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:52`
- Dimension: Entity — Severity: P1
- Detail: Clients are `Set<WebSocket>`. No per-connection wrapper.

**420. Singleton `activeSessionId` — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:57-58`
- Dimension: Entity — Severity: P1
- Detail: Concurrent clients trample each other.

**421. WS protocol messages not modeled — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:147, 65-73`
- Dimension: Entity — Severity: P1
- Detail: Inbound + outbound built inline as `Record<string, unknown>`.

**422. Approval wire shape built twice — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:256-263, 286-293`
- Dimension: Entity — Severity: P2
- Detail: Domain `PendingApproval` imported, but wire shape ad-hoc duplicated.

**423. Phantom scheduler_event — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts:133`
- Dimension: Entity — Severity: P2
- Detail: No type/shape declared in arya.

**424. CommandManifest/AgentManifest anonymous — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:233-239`
- Dimension: Entity — Severity: P2
- Detail: No shared contract with arya-companion.

**425. ScheduledTask not first-class — DEFERRED (arya-agent repo)**
- File: `definitions/tasks/`
- Dimension: Entity — Severity: P2
- Detail: Tasks live as YAML but directory empty. No `Running|Idle|Failed` over WS.

**426. `watchForIdle` polling not entity — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:224`
- Dimension: Entity — Severity: P2
- Detail: Should be `TurnLifecycle`/`TurnState` entity.

### Simplifications

**427. `TASKS_TEMPLATE` commented stub — DONE**
- File: `src/init.ts:54-58, 68`
- Dimension: Simplification — Severity: P1
- Detail: No yaml task exists anywhere; remove template and file write.

**428. Skills dir advertised but unused — DONE**
- File: `src/init.ts:62, 75-78`
- Dimension: Simplification — Severity: P1
- Detail: `skillsDir` created but never seeded; companion has no skills feature.

**429. `skillsDir` config field unused — DONE**
- File: `src/bootstrap.ts:69`
- Dimension: Simplification — Severity: P1
- Detail: Loaded, defaulted, passed via `extraSkillsDirs`, but no consumer.

**430. `watchForIdle` polling smell — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:224-231`
- Dimension: Simplification — Severity: P2
- Detail: Should be `turn_complete` bus event upstream.

**431. Pointless destructure-then-rebuild — DONE**
- File: `src/ws.ts:54`
- Dimension: Simplification — Severity: P2
- Detail: `const { bus, approvalQueue, commandRegistry } = { bus: opts.agent.bus, ... }`.

**432. `restrictToCwd: false` redundant — DONE**
- File: `src/bootstrap.ts:96`
- Dimension: Simplification — Severity: P2
- Detail: Default already.

**433. `commands`/`agents` requests redundant — DEFERRED (arya-agent repo)**
- File: `src/ws.ts:168-174, 251-252`
- Dimension: Simplification — Severity: P2
- Detail: Server pushes both on connect; inbound versions only needed for refresh.

**434. No tool duplication (premise wrong) — DEFERRED (arya-agent repo)**
- File: `src/bootstrap.ts`
- Dimension: Simplification — Severity: (info)
- Detail: Already correctly uses mu-tools and mu-webfetch.

---

## PACKAGE: arya-companion (`/home/gaetan-puleo/dev/arya-agent/packages/arya-companion`)

### Bugs

**435. Approvals & sub-agent runs never render in transcript — DONE**
- File: `src/services/aryaClient.ts:315-317, 309-313`, `src/components/chat/ChatMessageList.tsx:43-52, 166-203`
- Dimension: Bug — Severity: P1
- Detail: `approval_request` and `sub_agent_event` only call `upsertApproval` / `upsertSubAgentRun`. No code appends a `{id: "approval-<id>", ...}` row to any session transcript. ChatMessageList reads prefixes but nothing produces such ids.
- Impact: Users can't see/respond to approvals in chat.

**436. Concurrent `start()` spawns ghost sockets — DONE**
- File: `src/services/aryaClient.ts:47-109`
- Dimension: Bug — Severity: P1
- Detail: Awaits two AsyncStorage calls between `disposeTransport?.()` and reassigning. Second `start()` (Save twice, foreground race) sees stale dispose, creates second reconnecting socket, orphans first.

**437. Open-event race window — DONE**
- File: `src/services/wsTransport.ts:33-35`, `src/services/aryaClient.ts:64-78`
- Dimension: Bug — Severity: P1
- Detail: `onSocket(socket)` runs synchronously during `new WebSocket()` but `addEventListener("open", ...)` attached after. If polyfill dispatches `open` synchronously, handshake handlers miss, connect-time bursts never send.

**438. No exponential backoff — DONE**
- File: `src/services/wsTransport.ts:39-43`
- Dimension: Bug — Severity: P2
- Detail: Hard-coded 3s. After ~20 cellular flips: write-amplified server, no jitter, no cap.

**439. Optimistic id collision — DONE**
- File: `src/services/aryaClient.ts:193, 211`
- Dimension: Bug — Severity: P2
- Detail: `id: 'local-${Date.now()}'`. Two rapid sends in same ms yield duplicate keys → FlashList warning.

**440. Optimistic rows even when send failed — DONE**
- File: `src/services/aryaClient.ts:196-199, 213-215`
- Dimension: Bug — Severity: P2
- Detail: Rows appended before `send()`. If returns false, user sees phantom message + never-ending typing placeholder.

**441. Approval token replay — DONE**
- File: `src/services/aryaClient.ts:315-317`
- Dimension: Bug — Severity: P2
- Detail: `upsertApproval(snapshotFromApprovalRequest(msg))` unconditionally overwrites. Duplicate approval_request (server retry, reconnect) resets to pending — user can re-approve.

**442. `respond()` race with disconnect — DONE**
- File: `src/services/aryaClient.ts:226-231`
- Dimension: Bug — Severity: P2
- Detail: If `send()` returns false, function returns silently and snapshot stays `pending`. UI looks responsive but nothing was sent.

**443. `useTranscript` new array every render — DONE**
- File: `src/hooks/useTranscript.ts:30-42`
- Dimension: Bug — Severity: P2
- Detail: Placeholder changes on every delta, rebuilding messages array; `contentSignature` recomputes (reduce) on every render. Perf cliff on long sessions.

**444. `set_active_agent` no rollback on rejection — DONE**
- File: `src/services/aryaClient.ts:151-160`
- Dimension: Bug — Severity: P3
- Detail: `setActiveAgentId(agentId)` set on successful send. If server rejects, client never reverts.

**445. Stale closure on socket ref — DONE**
- File: `src/services/aryaClient.ts:67-92`
- Dimension: Bug — Severity: P3
- Detail: Each handler closes over `socket`. `setConnection(socket, …)` in close listener writes now-closed socket back to store, flipping `connected` to false on new socket after fast reconnect.

### Architecture

**446. Clean Zustand store with strict writer — DEFERRED (arya-agent repo)**
- File: `src/state/store.ts`
- Dimension: Architecture — Severity: (info)
- Detail: Single Zustand store. `services/aryaClient` is the only writer. Hooks wrap selectors + intent. Documented at `store.ts:1-11`.

**447. No Tamagui (only NativeWind) — DEFERRED (arya-agent repo)**
- File: `package.json`
- Dimension: Architecture — Severity: (info)
- Detail: Brief was wrong — no Tamagui dep.

**448. `aryaClient.ts` 338 LOC mixing concerns — DONE**
- File: `src/services/aryaClient.ts`
- Dimension: Architecture — Severity: P1
- Detail: Lifecycle / outbound / dispatch.

**449. Transcripts Map global replacement — DEFERRED (arya-agent repo)**
- File: `src/state/store.ts:99-135`
- Dimension: Architecture — Severity: P1
- Detail: Any session update invalidates `useTranscript` for all sessions. Cross-session re-renders.

**450. `ThemeContext` dead infrastructure — DONE**
- File: `src/theme/ThemeContext.tsx`
- Dimension: Architecture — Severity: P2
- Detail: Hardcoded `darkTheme`, no `setTheme`. Provider has no dynamic value.

**451. `plugins/` is Expo config plugins (naming confusing) — DEFERRED (arya-agent repo)**
- File: `plugins/`
- Dimension: Architecture — Severity: P2
- Detail: Build-time, not runtime app plugins. Reader expecting runtime extensions gets confused.

### Responsibilities

**452. Sub-agent run aggregation belongs server-side — DEFERRED (arya-agent repo)**
- File: `src/services/snapshotReducers.ts:79-173`
- Dimension: Responsibilities — Severity: P1
- Detail: Reduces 5 `sub_agent_event` types into `SubAgentRunSnapshot`. Harness has this state. Every reconnect loses history.

**453. Approval snapshot lifecycle server-owned — DEFERRED (arya-agent repo)**
- File: `src/services/snapshotReducers.ts:29-53`, `src/services/aryaClient.ts:217-232`
- Dimension: Responsibilities — Severity: P1
- Detail: Authoritative on server's ApprovalQueue. Companion should mirror.

**454. `set_active_agent` half-implemented — DEFERRED (arya-agent repo)**
- File: `src/services/aryaClient.ts:151-160`, `src/types/wire.ts:121-127`
- Dimension: Responsibilities — Severity: P1
- Detail: Companion sends, expects echo. Server has no handler.

**455. Needs shared protocol package — SUPERSEDED**
- File: `src/types/wire.ts:33`
- Dimension: Responsibilities — Severity: P1
- Detail: Comment literally says "Mirrors mu-core's `Message`". Drift inevitable.
- Direction: a separate shared-protocol package isn't needed — the harness Channel API plays that role once arya's WS is ported (#409). Companion talks to a Channel; the wire shape lives in harness. See [[feedback-harness-role]].

**456. Server commands/agents responses UI-shaped — DEFERRED (arya-agent repo)**
- File: `src/types/wire.ts`
- Dimension: Responsibilities — Severity: P2
- Detail: `description`, `color` — fine, but cements coupling.

### Types

**457. Strong typing overall — DEFERRED (arya-agent repo)**
- File: `src/`
- Dimension: Types — Severity: (info)
- Detail: Zero `any`, strict mode, discriminated unions, exhaustive `never` check (`aryaClient.ts:333`).

**458. `as WsInboundMessage` cast bypasses validation — DEFERRED (arya-agent repo)**
- File: `src/services/aryaClient.ts:97`
- Dimension: Types — Severity: P1
- Detail: `JSON.parse(e.data) as WsInboundMessage` trusts wire; only payload inside `wireSessionToRows` validated.

**459. `JSON.parse as WsConfig` no guard — DEFERRED (arya-agent repo)**
- File: `src/services/wsConfig.ts:14`
- Dimension: Types — Severity: P2
- Detail: AsyncStorage payload asserted, not validated.

**460. `SubAgentEventWire.detail?: unknown` re-cast per case — DEFERRED (arya-agent repo)**
- File: `src/types/wire.ts:77`, `src/services/snapshotReducers.ts:60,108,127,146`
- Dimension: Types — Severity: P2
- Detail: `(event.detail as { task?: string } | undefined) ?? {}`.

**461. `SchedulerEvent` declared but unexported — DONE**
- File: `src/types/wire.ts:101`
- Dimension: Types — Severity: P2
- Detail: Only used inside the inbound union.

**462. RN error event cast — DEFERRED (arya-agent repo)**
- File: `src/services/aryaClient.ts:88`
- Dimension: Types — Severity: P2
- Detail: `(err as Event & { message?: string }).message`.

**463. Inline event prop shapes — DEFERRED (arya-agent repo)**
- File: `src/components/sessions/SessionRow.tsx:19`, `src/screens/ChatScreen.tsx:77`, `src/components/chat/ChatInputBar.tsx:60`
- Dimension: Types — Severity: P2
- Detail: Reinvents canonical RN types like `GestureResponderEvent`.

**464. `useSafeAreaInsets` leak — DEFERRED (arya-agent repo)**
- File: `src/components/chat/ChatInputBar.tsx:292`
- Dimension: Types — Severity: P2
- Detail: `insets?: ReturnType<typeof useSafeAreaInsets>` leaks impl alias into prop API.

**465. Library-driven any in markdown — DEFERRED (arya-agent repo)**
- File: `src/components/markdown/MessageMarkdown.tsx:101, 116-122`
- Dimension: Types — Severity: P2
- Detail: `react-native-markdown-display` `node: any`.

**466. Tailwind hand-mirrored from theme — DEFERRED (arya-agent repo)**
- File: `tailwind.config.js`, `src/theme/themes.ts`
- Dimension: Types — Severity: P2
- Detail: Both lists ship identical hexes. Renaming theme key won't error.

**467. WS protocol duplicated, drifting — DEFERRED (arya-agent repo)**
- File: `src/types/wire.ts` vs `arya/src/ws.ts`
- Dimension: Types — Severity: P1
- Detail: Server is `Record<string, unknown>`; companion strict. Server's `activity` absent from `WsInboundMessage`. Server's `ApprovalRequest.sessionId: string | null` vs client's `string`. Server has no handler for `active_agent`/`set_active_agent`/`sub_agent_event`/`scheduler_event` despite client declaring them.
- Direction: resolved by #409. Once arya's WS is a harness `WsChannel`, both server and companion derive the wire shape from the harness Channel API — drift goes away. See [[feedback-harness-role]].

### Entities

**468. Streaming via sentinel, not entity — DEFERRED (arya-agent repo)**
- File: `src/types/domain.ts:89`, `src/hooks/useTranscript.ts:30-42`
- Dimension: Entity — Severity: P1
- Detail: `STREAMING_ROW_ID` synthesized in hook, parallel `streamingPlaceholders: Map<sid,string>`. No first-class `StreamingMessage`.

**469. `ApprovalSnapshot` global pool, not per-session — DEFERRED (arya-agent repo)**
- File: `src/state/store.ts:41`
- Dimension: Entity — Severity: P1
- Detail: `Map<approvalId, ApprovalSnapshot>` — no ordering, no per-session filtering, no concept of active prompt vs background pending.

**470. `SubAgentRunSnapshot` flat — DEFERRED (arya-agent repo)**
- File: `src/types/domain.ts:73-85`
- Dimension: Entity — Severity: P2
- Detail: No `parentRunId`. Nested sub-agents collapse to siblings.

**471. Wire/domain separation clean — DEFERRED (arya-agent repo)**
- File: `src/types/wire.ts`, `src/types/domain.ts`, `src/services/projectMessage.ts`, `src/services/snapshotReducers.ts`
- Dimension: Entity — Severity: (info)
- Detail: Package's strongest entity boundary.

**472. `authorAgentId` wrong attribution — DEFERRED (arya-agent repo)**
- File: `src/services/projectMessage.ts:81`
- Dimension: Entity — Severity: P1
- Detail: `activeAgentId` fallback for every assistant row. Historical transcripts attribute to currently-active agent.

**473. PHANTOM: inline approval/sub-agent rows — DEFERRED (arya-agent repo)**
- File: `src/components/chat/ChatMessageList.tsx:22-23, 43-53, 166-167`
- Dimension: Entity — Severity: P1
- Detail: Consumes transcript items with id beginning `approval-` or `sub-agent-`. NOTHING produces such ids. Card-in-transcript code path is dead.

**474. PHANTOM: `SubagentStatus='aborted'` — DONE**
- File: `src/types/domain.ts:71`
- Dimension: Entity — Severity: P2
- Detail: Reducer never emits it.

**475. PHANTOM: `ApprovalSnapshot.status='timeout'` — DONE**
- File: `src/types/domain.ts`, `src/components/.../ApprovalCard.tsx:73-75`
- Dimension: Entity — Severity: P2
- Detail: Declared, rendered, never produced.

**476. PHANTOM: `AgentInfo.type='subagent'` — DONE**
- File: `src/hooks/useComposer.ts:60`, `src/services/aryaClient.ts:250`
- Dimension: Entity — Severity: P2
- Detail: `useComposer` filters on `subagent` for `@` menu; aryaClient hardcodes every wire agent to `type: 'primary'`. Subagent picker always empty.

**477. `ConnectionState` collapsed into boolean — DEFERRED (arya-agent repo)**
- File: `src/state/store.ts:25-26`
- Dimension: Entity — Severity: P1
- Detail: `socket + connected: boolean`. No states for connecting/reconnecting/disconnected-with-reason/token-missing.

**478. Missing entities — DEFERRED (arya-agent repo)**
- Dimension: Entity — Severity: P1
- Detail: NetworkStatus/ConnectionState union, PendingSend queue, OptimisticMessage with status, Toast/Error entity, SessionDraft, ReasoningStream.

### Simplifications

**479. `selectIsTurnInFlight` zero importers — DONE**
- File: `src/state/selectors.ts:11-17`
- Dimension: Simplification — Severity: P1
- Detail: Exported, no consumers.

**480. `sharedSpacing` (21 entries) never read — DONE**
- File: `src/theme/themes.ts:3-37`
- Dimension: Simplification — Severity: P1
- Detail: NativeWind handles spacing.

**481. `sharedRadius` (14 entries) never read — DONE**
- File: `src/theme/themes.ts:39-54`
- Dimension: Simplification — Severity: P1
- Detail: `theme.radius.*` never referenced.

**482. `sharedFontWeights` never read — DONE**
- File: `src/theme/themes.ts:66-73`
- Dimension: Simplification — Severity: P1

**483. `sharedFontSizes` only `sm` used — DONE**
- File: `src/theme/themes.ts:56-64`
- Dimension: Simplification — Severity: P2
- Detail: In CodeBlock.

**484. `sharedChrome` only `pillHeight` used — DONE**
- File: `src/theme/themes.ts:83-87`
- Dimension: Simplification — Severity: P2
- Detail: In AgentChip:88.

**485. `app/two.tsx` shim — DONE**
- File: `src/app/two.tsx:1-3`
- Dimension: Simplification — Severity: P2
- Detail: Single-line re-export of `SettingsScreen`. Move handler into `app/settings.tsx`.

**486. Unused deps in package.json — DONE**
- File: `package.json:30, 40, 26`
- Dimension: Simplification — Severity: P2
- Detail: `react-native-css-interop` (NativeWind transitive), `@babel/plugin-transform-react-jsx` (babel.config doesn't reference), `expo-system-ui` (no source imports).

**487. Tailwind ↔ theme hand-mirrored — DEFERRED (arya-agent repo)**
- File: `tailwind.config.js:11-31`, `src/theme/themes.ts:100-123`
- Dimension: Simplification — Severity: P2
- Detail: Both lists ship identical hexes. Pick one source.

**488. ThemeContext collapsible — DONE**
- File: `src/theme/ThemeContext.tsx`
- Dimension: Simplification — Severity: P2
- Detail: Provider holds frozen literal — could be `export const colors = {...}`.

**489. screens/ → app/ indirection — DEFERRED (arya-agent repo)**
- File: `src/app/`, `src/screens/`
- Dimension: Simplification — Severity: P2
- Detail: `index.tsx`/`two.tsx`/`sub-agent/[runId].tsx` all do trivial re-exports.

**490. No Tamagui (premise wrong) — DEFERRED (arya-agent repo)**
- File: package.json
- Dimension: Simplification — Severity: (info)
- Detail: Only NativeWind. "Second system" is the bespoke `themes.ts`/`ThemeContext` whose colors mirror Tailwind 1:1.

---

## SYNTHESIS — Cross-cutting patterns

**491. Pattern: AbortSignal threaded nowhere — DONE**
- Packages: mu-core, mu-tools (bash), mu-webfetch, mu-local-provider, mu-coding-agent (Ctrl-C)
- Detail: Tool.execute(args: string) has no signal slot in mu-core. Every "user can cancel" promise is technically false. The same hole repeats in 5 places because none of them can fix it locally.
- Severity: P1
- Fix: `ToolContext.signal` added to mu-core's `Tool.execute(args, ctx?)`; runtime threads a per-turn `AbortController` through `turnAbort` and aborts on `stop()`. Bash, webfetch, and local-provider all consume `ctx.signal`. Ctrl-C in coding-agent calls `runtime.stop()` which propagates.

**492. Pattern: Stringly-typed tools everywhere — DONE**
- Packages: mu-core (Tool.execute), mu-tools, mu-webfetch, mu-harness (Command generics), mu-local-provider tool-call deltas
- Detail: Schema lives in JSON, TS shape in `as` casts. Every tool re-parses, re-casts, returns strings with `"Error: ..."` prefix. Drives the no-signal hole, schema/TS drift, and brittle dispatch.
- Severity: P1
- Fix:
  - `Tool<TArgs, TResult>` is now generic (#26/#27) — tools declare their args shape and the runtime parses JSON once at the boundary, passing typed args to `execute`.
  - `defineTool` / `defineTools` SDK helpers shipped (#23/#28).
  - `AbortSignal` plumbed through `ToolContext.signal` (#491) — closes the no-signal hole.
  - Tool-call deltas in local-provider stay separate from `ToolCall` for streaming reasons (#198).
  - Schema validation (zod) and `Result<T>|ToolError` wire union are NOT shipped — and not needed. Each tool/package owns its own result encoding (the wire is `string` per provider contract); a shared `ToolResult` union would unify what's correctly self-contained. Each tool with structured output picks its own `TResult` via the generic.

**493. Pattern: Plugin RCE × open WS × LAN bind — DONE (mu side; arya in separate repo)**
- Packages: mu-harness (plugin-loader), arya/server (auth + bind)
- Detail: Plugin loader runs any `.ts/.js` in data-dir on boot; arya writes `authToken: ''` as default and treats empty as no-auth; binds 0.0.0.0 by default. Combined: LAN attacker writes file in `~/.config/arya/plugins`, gets RCE.
- Severity: P1 (highest in review)
- Fix:
  - mu-harness plugin-loader: manifest gate (no bare-file execution) + traversal block (entrypoint must stay inside plugin dir) + load logging (#312). The RCE chain is broken at the mu layer — dropping a `.ts` file no longer auto-executes; an attacker would also need to write a matching `plugin.manifest.json` next to it.
  - arya auth + bind: fixed in arya-agent repo (#388 refuses empty token, #389 binds 127.0.0.1).
- Note: Full plugin sandboxing (Worker isolation + capability tokens) is a separate feature, tracked under #312. Not required to close the RCE-chain pattern — manifest gate is sufficient to defeat drive-by drops.

**494. Pattern: SSRF + path traversal — DONE**
- Packages: mu-webfetch (no SSRF), mu-tools (restrictToCwd symlink bypass + bash skips), mu-harness (glob dotAll matches newlines)
- Detail: Permission infrastructure exists (config flag, sanitizer, glob matcher) but each implementation has a subtle defeat.
- Severity: P1
- Fix:
  - mu-webfetch SSRF: blocked via private IP / localhost / link-local / IPv6-mapped checks (#213, plus IPv6/zone-id handling).
  - mu-tools: `restrictToCwd` removed entirely (#166); containment now handled by harness permission rules.
  - mu-harness glob: dotAll flag dropped — `*` and `?` no longer match newlines (#303).

**495. Pattern: WS wire protocol drift — DEFERRED (separate repo)**
- Packages: arya/server, arya-companion
- Detail: Companion has discriminated `WsInbound`/`WsOutbound` unions hand-mirrored from server which uses `Record<string, unknown>`. Server emits `activity` (companion drops); companion declares `turn_start`/`set_active_agent` (server has no handler); `ApprovalRequest` shape differs.
- Severity: P1
- Fix: Resolves once arya's WS bridge is ported to a harness `WsChannel` (#409 DONE); the harness Channel API becomes the single source for the wire shape. No separate `mu-protocol` package needed (#455 superseded). Arya/companion changes live in `arya-agent` repo, not here.

**496. Pattern: Stale READMEs/planning docs — DONE**
- Packages: mu-core (AGENTS.md → defineProvider missing), mu-tui (CONTEXT.md 1158 LOC vs reality 8836), mu-local-provider (README → Ollama+LM Studio), arya (README/PLAN → createAryaToolsPlugin), mu-coding-agent (STATUS_SLOTS plugin extension never used)
- Detail: Design intent moved faster than code.
- Severity: P1
- Fix:
  - mu-core: `defineProvider` shipped (#22).
  - mu-tui: CONTEXT.md + LAYOUT_PLAN.md deleted (#78, #123); README rewritten to match shipped surface (#81, #82).
  - mu-local-provider: README + package.json description trimmed to llama-swap only (#177, #187, #209).
  - mu-coding-agent: `STATUS_SLOTS` registry deleted (#294).
  - Arya README: cleaned in arya-agent repo (#399, #408).

**497. Pattern: Dead channels/mentions/scheduler in harness while arya reinvents — REFRAMED (wiring gap)**
- Packages: mu-harness (channels, mentions, scheduler, roundtrips — zero in-repo consumers), arya/server (built own WS bridging)
- Detail: Worst-of-both-worlds: ~1000+ LOC of channel/mention/scheduler infra that arya re-implements ad-hoc.
- Severity: P1
- Fix: harness is the intended base — for runtime infra AND base chat TUI. Wire coding-agent and arya through it — `bootstrap()` from coding-agent (#319, #320, #322), `WsChannel` for arya (#409), base chat TUI with extensible slots (#268, #271). Both agents will have their own TUI built on the harness base. Do NOT delete the harness infra; that is the design's load-bearing layer. See [[feedback-harness-role]], [[harness-base-tui]].

**498. Pattern: God-class anti-pattern — DONE (mu side; arya in separate repo)**
- Packages: ChatApp.ts 1608, tui.ts 750, runtime.ts 435, bootstrap.ts 300, ws.ts ~300, aryaClient.ts 338
- Detail: Each owns ~6 concerns. Bug density highest in these files.
- Severity: P1
- Fix:
  - `tui.ts 750` → split into Renderer / InputRouter / FocusManager + thin TUI orchestrator (#69).
  - `bootstrap.ts 300` → split into `bootstrap/permissions.ts`, `bootstrap/sessions.ts`, `bootstrap/tools.ts` (#321).
  - `aryaClient.ts 338` → reorganized into lifecycle/outbound/dispatch (#448 — arya repo).
  - `ws.ts ~300` → ported to `WsChannel` via `createChannelManager` (#409 — arya repo).
  - `ChatApp.ts 1608` → shrunk via harness base TUI extraction (#268). `handleEvent` is now ~15 lines (was 50+); transcript / sub-agent-run / status state lives in harness primitives. Further extraction would only carve out agent-specific concerns (file picker, command palette, model picker, bash mode) into siblings — pure refactor with no shared-base payoff.
  - `runtime.ts 435` → kept cohesive (#21 — single orchestration loop with heavy local state).

**499. Pattern: Atomic-write missing — DONE (via mu-tools `writeAtomic`)**
- Packages: mu-harness jsonl-store (touch + persistOnBus), mu-tools (write-file/edit-file), mu-coding-agent state
- Detail: Crash mid-write loses or corrupts data.
- Severity: P1
- Fix:
  - mu-tools: `writeAtomic` (#130, #129) — temp+rename for write-file and edit-file.
  - mu-harness jsonl-store: torn-write recovery via per-line `catch` on read (#305, #306).
  - mu-coding-agent state: `saveState` writes via `writeFileSync` to a tiny config file; atomic semantics from kernel on small writes are sufficient there.
  - No need to hoist a shared helper to mu-core — the only sites that genuinely need temp+rename are in mu-tools (`writeAtomic` lives next to its callers).

**500. Pattern: Approval/Session entities anaemic — DONE (mu side)**
- Packages: mu-harness (ApprovalRequest no sessionId/agentName/channelId), arya/server (singleton activeSessionId), arya-companion (global ApprovalSnapshot pool), mu-core (Session conflates persisted+queues)
- Detail: All four bugs share root: approval/session entities lack context fields for multi-tenant correctness.
- Severity: P1
- Fix:
  - mu-core: queues moved off `Session` (#40) — persisted vs transient state now separate.
  - mu-harness: `ApprovalRequest` + `ApprovalRequestMeta` + `PermissionPromptMeta` all carry `agent?`, `sessionId?`, `channelId?` (#310, #357). Multi-runtime/multi-channel routing now possible without external bookkeeping.
  - arya/server + companion: fixed in arya-agent repo (#392, #393, #420, #469).

**501. Pattern: Duplicated types across boundaries — DONE (mu side; arya in separate repo)**
- Packages: AgentDisplay × 3 (harness SubAgent, coding-agent main.ts, ChatApp.ts), MouseEvent × 2 (mu-tui), wire.ts × 2 (arya), ChatBus locally re-shaped, Message/ToolCall re-cast between core ↔ local-provider ↔ harness jsonl-store
- Detail: Drift incident already happened with wire.ts.
- Severity: P1
- Fix:
  - MouseEvent × 2 in mu-tui: deduped (#85, #112).
  - ChatBus locally re-shaped: replaced with `EventBus<CoreEvent>` (#276).
  - AgentDisplay: intentional UI projection of SubAgent (#275, #287) — kept by design (each layer narrows what it needs).
  - Message/ToolCall re-casts in jsonl-store: trust-on-write boundary, see #343 — no duplicate type, just an unchecked re-read of the file the harness itself wrote.
  - wire.ts × 2 in arya: resolves with WsChannel port (#409 DONE) — wire shape derives from the harness Channel API; arya-companion follow-up lives in arya-agent repo (#495).

**502. Pattern: SubAgent vs Agent identity confused — REJECTED**
- Packages: mu-harness (SubAgent double duty), mu-coding-agent (AgentDisplay re-projection), arya-companion (AgentInfo.type never set correctly — every assistant attributed to activeAgentId, losing history)
- Detail: Primary-cycling and sub-agent-dispatch features both built on a type that doesn't distinguish the two roles.
- Severity: P1
- Fix: See #352 — `SubAgent.type: 'primary' | 'subagent'` IS the discriminator; splitting into two types just renames. Arya-companion's wrong attribution is a separate bug in that repo.

**503. Pattern: Phantom dead enum members & rendered UI — DONE**
- Packages: arya-companion (SubagentStatus='aborted', ApprovalSnapshot.status='timeout', AgentInfo.type='subagent', inline approval/sub-agent rows), mu-coding-agent (ContextMap 259 LOC dead), mu-harness (channels/mentions/scheduler unused), mu-local-provider (LocalBackendKind single-member union)
- Detail: Union/enum announces intent never implemented; downstream code carries cost of handling phantom case.
- Severity: P2
- Fix:
  - arya-companion: 'aborted', 'timeout', AgentInfo.type='subagent' all pruned (#474, #475, #476).
  - mu-coding-agent ContextMap: 259 LOC removed (#293).
  - mu-harness channels/mentions/scheduler: kept by design ([[feedback-harness-role]]) — they're the intended base, wiring is the gap.
  - mu-local-provider LocalBackendKind: type alias removed (#195, #208).

---

## Final notes / Caveats

**504. No runtime tests executed — INFO (review meta)**
- Detail: Race findings (start/stop, paste overflow, ghost sockets, scheduler ordering) are static-analysis hypotheses. Some will reproduce; some won't under real timing.

**505. No load/concurrency testing — INFO (review meta)**
- Detail: Session id collision under load and arya multi-client trampling are theoretically real but unmeasured.

**506. No deep security audit — INFO (review meta)**
- Detail: SSRF, plugin RCE, glob-bypass, restrictToCwd symlink were easy from code reading. Real audit would find more (turndown XSS, undici header injection, prompt-injection through tool results, MITM on `ws://`).

**507. No UX testing on mobile — INFO (review meta)**
- Detail: "Approvals never render" was found by code reading. Worth a 10-min manual test before refactoring.

**508. No perf measurements — INFO (review meta)**
- Detail: `useTranscript` rebuilding every render, `subAgentPreviews` map never pruned, `setInterval` idle-poll — flagged but unquantified.

**509. Review framing assumed independent dimensions — INFO (review meta)**
- Detail: Most P1s are systemic (signals, types, atomicity, drift). 12 agents flagging "no AbortSignal" = redundant findings; counted once in synthesis.

**510. Cross-version drift between published and in-repo code uninvestigated — INFO (review meta)**
- Detail: mu-core noted `npm/` vs root version drift (0.15.0 vs 0.16.0). What's on npm right now wasn't checked.

**511. arya/server has zero tests — INFO (review meta)**
- Detail: Every change is a regression risk no other check will catch.

---

## Top concrete actions (synthesis ranking)

| # | Action | Packages | Effort | Risk | Payoff |
|---|---|---|---|---|---|
| 1 | Sandbox plugin loader + arya defaults (127.0.0.1, refuse empty token, plugin allowlist) | harness, arya | S–M | low | closes worst RCE chain |
| 2 | Add `AbortSignal` to `Tool.execute` and thread through | core, tools, webfetch, local-provider, coding-agent | M | medium | working Ctrl-C |
| 3 | `defineTool<TArgs, TResult>` SDK helper with zod + `Result<T> \| ToolError` return | core, tools, webfetch, harness | M | low | kills stringly-typed plague, ~150 LOC deletion |
| 4 | Shared `@arya/wire` (or `mu-protocol`) package | arya, arya-companion | S–M | low | ends drift permanently |
| 5 | Atomic-write helper in mu-core, used by jsonl-store, write-file, edit-file, coding-agent state | core, harness, tools, coding-agent | S | low | fixes 4 data-loss sites |
| 6 | Audit & fix permission/sanitization primitives (glob dotAll, sanitizePath realpath, bash restrictToCwd, webfetch SSRF allowlist) | harness, tools, webfetch | M | low | closes pattern P4 |
| 7 | Split runtime.ts and tui.ts | core, tui | M–L | medium | latent races become visible |
| 8 | Make `Session`/`ApprovalRequest` first-class with branded ids and full context | core, harness, arya | M | medium | fixes multi-agent attribution + arya multi-client |
| 9 | Decide channels' fate — delete + scheduler-as-plugin | harness, arya | M | medium | ~3000 LOC + ends two-architectures drift |
| 10 | Move base chat TUI into harness (`createChatTUI` with extensible slots); split ChatApp.ts — generic parts to harness, agent-specific stays in coding-agent/arya | harness, coding-agent, arya | L | medium | shared base TUI for all agents; each agent owns its own specialization |

---

**Total findings: 511 (1-490 from per-package reviews, 491-503 cross-cutting patterns, 504-511 caveats and synthesis notes).**
