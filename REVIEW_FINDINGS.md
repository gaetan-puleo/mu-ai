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

**13. `types/Tool.ts` is a junk drawer**
- File: `src/types/Tool.ts`
- Dimension: Architecture — Severity: P1
- Detail: Owns `Tool`, `ToolCall`, but also `LLMResponse`, `LLMStreamEvent`, `LLMResponseContext`, `ContextMap`, `ContextPart`. Provider-side response types do not belong in a file named `Tool.ts`.
- Fix: Split into `types/Tool.ts` (tool/call) and `types/LLM.ts` (response/stream/context); have `provider.ts` own response types.

**14. `tools/` folder name misleading**
- File: `src/tools/`
- Dimension: Architecture — Severity: P2
- Detail: Only `callTool` + `argUtils` live there — execution helpers — while the `Tool` type lives in `types/`. Either move helpers next to the type or rename to `executor/`.

**15. Stale published artifacts contradict source**
- File: `npm/`, `dist/`
- Dimension: Architecture — Severity: P1
- Detail: `npm/` and `dist/` still export `defineProvider`; live `src/provider.ts` does not. `npm/package.json` is at v0.15.0 with a different description than `package.json` v0.16.0.
- Fix: Either ship `defineProvider` or remove the AGENTS.md reference; drop checked-in build artifacts.

**16. `provider.ts` re-exports types it doesn't own**
- File: `src/provider.ts`
- Dimension: Architecture — Severity: P1
- Detail: Pulls `Message`, `LLMResponse`, `LLMStreamEvent`, `Tools` and re-exports them. These same types are also exported from `index.ts` via `./types/Tool`. Two public paths to the same symbol.

**17. Runtime↔Session coupling is implicit**
- File: `src/runtime.ts:111-114`
- Dimension: Architecture — Severity: P2
- Detail: `createRuntime` mutates `session.messages` / `steeringQueue` / `followUpQueue` directly. `SessionStore` is essentially a passive data container while `Runtime` owns mutation — non-obvious split.

**18. `bus.ts` `Unsubscribe` imported as type by `session.ts`**
- File: `src/session.ts`
- Dimension: Architecture — Severity: P2
- Detail: `Unsubscribe` could live in a `types/` file so `session.ts` doesn't have to reach into `bus.ts` just for a type alias.

**19. Two hook surfaces in one runtime**
- File: `src/plugin.ts`, `src/runtime.ts`
- Dimension: Architecture — Severity: P2
- Detail: Plugin has lifecycle hooks (`onStart`/`onStop`/`onError`) but per-tool `ToolHooks` (`beforeTool`/`afterTool`) are passed via `RuntimeConfig.hooks` separately.
- Fix: Consider merging into `Plugin.hooks`.

**20. `index.ts` exports utilities mixed with runtime helpers**
- File: `src/index.ts`
- Dimension: Architecture — Severity: P2
- Detail: `formatError`, `parseArgs`, `callTool` exported alongside runtime factories. Consider a `tools` sub-export so non-runtime consumers don't pull the whole core.

**21. `runtime.ts` is 435 lines mixing 6 concerns**
- File: `src/runtime.ts`
- Dimension: Architecture — Severity: P2
- Detail: Queue draining, provider resolution, stream consumption, finalization, lifecycle hooks, repeated-call detection. Good seams exist (`mergePluginTools`, `resolveProvider`, `processStream`, `executeToolCalls`).
- Fix: Extract into `src/runtime/` directory.

### Responsibilities

**22. `defineProvider()` advertised but missing**
- File: AGENTS.md vs `src/provider.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: AGENTS.md (line 57) advertises `defineProvider()` as a core primitive, but `provider.ts` only exports the `ProviderFactory<Config>` type.
- Fix: Either ship the helper or drop the promise.

**23. `defineTool()` / `definePlugin()` missing**
- File: `src/index.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: Standard SDK ergonomics for an advertised "Plugin SDK." Currently authors hand-roll `{ name, tools, hooks, provider }` objects.

**24. `createInMemorySessionStore` borderline scope**
- File: `src/session.ts:43-132`
- Dimension: Responsibilities — Severity: P2
- Detail: The interface belongs to core, but a concrete in-memory implementation with `idGen`/`now` overrides is host-flavored. Harness already ships `createJsonlSessionStore`.

**25. `package.json` description drift — DONE**
- File: `package.json`
- Dimension: Responsibilities — Severity: P2
- Detail: Description ("Agent runtime primitives: types, plugin SDK, runtime, sessions") accurate but repo context still says "hooks, event bus." Align.

### Types

**26. `Tool` not generic**
- File: `src/types/Tool.ts:1-8`
- Dimension: Types — Severity: P1
- Detail: `parameters: Record<string, unknown>` plus `execute: (args: string) => …` means tool authors can never get a typed `args` payload at compile time. Every tool re-parses JSON string and re-asserts shape.
- Fix: `interface Tool<TParams = unknown, TResult = string> { parameters: JSONSchema; execute(args: TParams): TResult | Promise<TResult> }`.

**27. `Tool.execute` returns string only**
- File: `src/types/Tool.ts:6`
- Dimension: Types — Severity: P1
- Detail: Returns `string | Promise<string>`. Forces every structured result to be re-serialized.

**28. `Tools = Record<string, Tool>` erases names**
- File: `src/types/Tool.ts:10`
- Dimension: Types — Severity: P2
- Detail: No way for downstream packages to express "the tool map produced by this plugin contains `read` and `write`". A const-friendly helper would preserve literal keys.

**29. Escape hatches in public response shape**
- File: `src/types/Tool.ts:50-51`
- Dimension: Types — Severity: P2
- Detail: `timings?: Record<string, unknown>; raw?: Record<string, unknown>` are pure escape hatches.

**30. `ToolCall.args: string` stringly-typed**
- File: `src/types/Tool.ts:12-17`
- Dimension: Types — Severity: P1
- Detail: Locks the entire pipeline into JSON-string passing.

**31. No `readonly` on Session identity fields — DONE**
- File: `src/types/Session.ts:8-18`
- Dimension: Types — Severity: P2
- Detail: `id`, `createdAt`, `forkedFrom` should be `readonly`.

**32. `Message` not a discriminated union by role**
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

**35. `EventBus<Event>` has no filtering primitive**
- File: `src/bus.ts:3-6`
- Dimension: Types — Severity: P1
- Detail: Every consumer takes `(event: Event) => void` and writes its own `if (event.type === …)` ladder. A typed `subscribe<K extends Event['type']>` overload would massively improve ergonomics.

**36. `Plugin` is non-generic**
- File: `src/plugin.ts:10-15`
- Dimension: Types — Severity: P2
- Detail: A plugin with a typed config loses its `Config` once wrapped.

**37. `SessionStoreEvent` mixes session vs sessionId**
- File: `src/session.ts:5-8`
- Dimension: Types — Severity: P2
- Detail: `deleted` only carries `sessionId`, the others carry the full `Session`. Inconsistent.

**38. `Resolvable<T>` pattern duplicated — DONE**
- File: `src/types/Tool.ts:5`, `src/runtime.ts:49`
- Dimension: Types — Severity: P2
- Detail: 3-arm functor type `string | (() => string | undefined | Promise<string | undefined>)` duplicated verbatim.
- Fix: Extract `type Resolvable<T> = T | (() => T | Promise<T>)`.

**39. `parseArgs` returns Record without brand**
- File: `src/tools/argUtils.ts:13`
- Dimension: Types — Severity: P2
- Detail: Cast unavoidable post-`JSON.parse`, but signature could return a `JsonObject` branded type.

### Entities

**40. `Session` conflates persisted state + runtime queues**
- File: `src/types/Session.ts`
- Dimension: Entity — Severity: P1
- Detail: `steeringQueue` / `followUpQueue` are runtime-only working memory but live on the persisted entity. They round-trip through any serializer.
- Fix: Move to `Runtime` or `TurnState`.

**41. `Message` has no identity**
- File: `src/types/Message.ts`
- Dimension: Entity — Severity: P1
- Detail: No id, no timestamp, no provenance. Forking by `Session.forkedFrom.atIndex` is brittle.

**42. `Message` role/payload union is implicit**
- File: `src/types/Message.ts`
- Dimension: Entity — Severity: P1
- Detail: `role: 'tool'` requires `tool_id`; `role: 'assistant'` may carry `tool_calls`. Discriminated union would eliminate optional-field soup.

**43. `ToolResult` not first-class**
- File: `src/types/Message.ts`, `src/types/Tool.ts`
- Dimension: Entity — Severity: P1
- Detail: Smuggled as `Message { role:'tool', content:string, tool_id }`. No place for `isError`, structured payload, latency, or originating ToolCall reference.

**44. `Tool.systemPrompt` phantom**
- File: `src/types/Tool.ts`, `src/runtime.ts:207`
- Dimension: Entity — Severity: P2
- Detail: Declared, explicitly unused in runtime.

**45. `Plugin` is a bag**
- File: `src/plugin.ts`
- Dimension: Entity — Severity: P2
- Detail: Provider (exactly-one), tools (many), hooks (many) — very different cardinalities. `resolveProvider` enforces "exactly one" at runtime.

**46. `RuntimeState` incomplete**
- File: `src/runtime.ts`
- Dimension: Entity — Severity: P2
- Detail: ('idle'|'running'|'stopped') doesn't capture errored/awaiting-tool.

**47. `ContextPartKind` references concepts with no types**
- File: `src/types/Tool.ts:28-41`
- Dimension: Entity — Severity: P2
- Detail: Enumerates 'mcp' and 'skills' but mu-core has no MCP or Skills entities — leaked concerns from downstream.

**48. `SessionInit` asymmetric with `Session`**
- File: `src/session.ts`
- Dimension: Entity — Severity: P2
- Detail: Accepts `messages` but no queues/timestamps; invites silent loss on reconstruction.

**49. Missing entities**
- Dimension: Entity — Severity: P1
- Detail: Missing: `Turn` (the unit `processQueue` loops over), `ToolResult`, `Agent`, `Channel`, `Capability/Skill`, `ProviderConfig/ModelDescriptor`.

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

**55. Standalone hook type aliases redundant**
- File: `src/types/Hook.ts:17-18`, `src/index.ts:23,26`
- Dimension: Simplification — Severity: P2
- Detail: `BeforeToolHook` / `AfterToolHook` aliases redundant with `ToolHooks` shape.

**56. `consumeResult` IIFE-generator wrap — DONE**
- File: `src/runtime.ts:293-300`
- Dimension: Simplification — Severity: P2
- Detail: Wraps non-stream result in a `done`-only async generator. Handle inline; avoids 5-line wrapper + `isAsyncIterable` predicate.

**57. `seenCallIds` reconciliation dead defensive code**
- File: `src/runtime.ts:262-273`
- Dimension: Simplification — Severity: P2
- Detail: Local-provider only does one or the other per turn.

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

**69. `tui.ts` is 750-line god-object**
- File: `src/tui.ts`
- Dimension: Architecture — Severity: P1
- Detail: Mixes ≥7 concerns: lifecycle, render scheduling/throttling, diff algorithm, layout invocation, input router, focus traversal, feature lifecycle, global keybindings.
- Fix: Split into `renderer`, `inputRouter`, `featureHost`, `focusManager`.

**70. Legacy `canvas.ts` coexists with `cellbuffer.ts`**
- File: `src/layout/canvas.ts`
- Dimension: Architecture — Severity: P1
- Detail: `tui.ts` uses `cellbuffer.ts`; `canvas.ts` isn't imported anywhere outside its own tests — dead path that doubles the "what's the renderer" question.

**71. `Container` interface dead — DONE**
- File: `src/types/component.ts:63`
- Dimension: Architecture — Severity: P2
- Detail: `TUI.addChild` etc. duplicates it. Comment admits "kept for backward compatibility"; nothing implements it.

**72. `Box.measure()` duplicates layout-engine logic**
- File: `src/components/Box.ts:32-59`
- Dimension: Architecture — Severity: P2
- Detail: Re-implements row/column main-axis summing — layout responsibility leaks into a component.

**73. Composition rules unmodeled**
- File: `src/components/Modal.ts:5`
- Dimension: Architecture — Severity: P2
- Detail: `Modal` imports `Box` but most other components don't compose. Component-to-component coupling unmodeled.

**74. No barrel for `layout/` or `features/`**
- File: `src/index.ts`, `package.json`
- Dimension: Architecture — Severity: P2
- Detail: Hand-picks types from `./layout/types` and feature symbols aren't re-exported. Tests/consumers must use deep paths.

**75. `feature.ts` location inconsistent**
- File: `src/feature.ts`
- Dimension: Architecture — Severity: P2
- Detail: Lives at root, but `features/` is a sibling folder. Natural location would be `features/types.ts` or `features/index.ts`.

**76. Mouse-event target uses linear search**
- File: `src/tui.ts:343-352`
- Dimension: Architecture — Severity: P2
- Detail: Walks `parent` via `find()` on every event — N² over entry list.

**77. `LAYOUT_PLAN.md` Phase 18 unimplemented**
- File: `LAYOUT_PLAN.md`, `package.json`
- Dimension: Architecture — Severity: P1
- Detail: Prescribes `./components`, `./layout`, `./features` exports. `package.json` exposes only `.` and `./components`.

**78. `README.md` + `CONTEXT.md` severely stale — DONE**
- File: `README.md`, `CONTEXT.md`
- Dimension: Architecture — Severity: P1
- Detail: Describe the package as a flat 8-file, 1158-LOC "render engine, not a widget library" with no components folder. Reality: 8836 LOC, 9 components shipped, full layout engine.

**79. `focusScope` unimplemented**
- File: `src/tui.ts:175-181`, `LAYOUT_PLAN.md`
- Dimension: Architecture — Severity: P2
- Detail: Phase 11 says focus scopes should use `scope?: Component`. Current `getFocusableComponents()` ignores `focusScope` entirely.

### Responsibilities

**80. Cleanest separation in monorepo**
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

**85. Duplicate mouse types**
- File: `src/types/mouse.ts:1-16`, `src/events.ts:25-45`
- Dimension: Types — Severity: P1
- Detail: Two public mouse vocabularies for one concept. `MouseEvent` and `MouseButton` clash with `MouseInputEvent` / different `MouseButton` shapes (`wheelUp` vs `scrollUp`).

**86. Cast in keybinds**
- File: `src/keybinds.ts:23`
- Dimension: Types — Severity: P1
- Detail: `as unknown as Record<string, boolean | undefined>` cast. Should be `(event as KeyInputEvent)[field]`.

**87. `userContext: unknown` everywhere**
- File: `src/layout/types.ts:165,178`, `src/tui.ts:43,78,112,117`
- Dimension: Types — Severity: P1
- Detail: A class-level generic `TUI<TContext = unknown>` would give consumers type-safe access to their theme/provider blob without casts.

**88. `Focusable` structural-only**
- File: `src/types/component.ts:48`
- Dimension: Types — Severity: P2
- Detail: `focused: boolean` is the sole discriminant. Any component with an unrelated `focused` field will be treated as focusable.

**89. `Container` legacy + unparameterized — DONE**
- File: `src/types/component.ts:63-70`
- Dimension: Types — Severity: P2
- Detail: `addChild`/`removeChild` take `Component` but no type narrowing.

**90. Layout primitives lack `readonly` — DONE**
- File: `src/layout/types.ts:5-32`
- Dimension: Types — Severity: P2
- Detail: `Rect`/`Size`/`Insets`/`Constraints` flow through `LayoutEntry`/`RenderContext`. Marking fields `readonly` would prevent consumer mutation of engine output.

**91. `margin: number | Partial<Insets>` allows `{}`**
- File: `src/layout/types.ts:120,122`
- Dimension: Types — Severity: P2
- Detail: `Partial<Insets>` allows empty object, which is meaningless.

**92. `StartableTerminal` cast bypasses contract**
- File: `src/tui.ts:26-29, 218, 244`
- Dimension: Types — Severity: P2
- Detail: `this.terminal as StartableTerminal` bypasses public Terminal contract.

**93. Inline `capabilities` shape cast**
- File: `src/tui.ts:94`
- Dimension: Types — Severity: P2
- Detail: `(terminal as { capabilities?: Capabilities })` ad-hoc.

**94. `Component.render` returns mutable array — DONE**
- File: `src/types/component.ts:23`
- Dimension: Types — Severity: P2
- Detail: `string[]` should be `ReadonlyArray<string>`. `render.ts:67` does defensive `slice`.

**95. `Capabilities` fully mutable — DONE**
- File: `src/capabilities.ts:78-87`
- Dimension: Types — Severity: P2
- Detail: `TUI.getCapabilities()` hands the live reference back.

**96. `GlobalKeybinding.handler: () => void`**
- File: `src/keybinds.ts:11-15`
- Dimension: Types — Severity: P2
- Detail: No event parameter. Unusually narrow vs rich `InputEvent` surface.

### Entities

**97. `Component` is a god interface**
- File: `src/types/component.ts:12`
- Dimension: Entity — Severity: P1
- Detail: 9 optional members spanning layout, render, events, measure, layout mutation (`prepareLayout`), key-release opt-in, `invalidate`. No clean split between leaf and container.

**98. `Container` is dead weight**
- File: `src/types/component.ts:59`
- Dimension: Entity — Severity: P1
- Detail: Comment admits kept for "backward compat"; `Box` re-implements add/remove and ignores it.

**99. Style is split 3 ways**
- File: `src/layout/types.ts`, `src/layout/cell.ts`
- Dimension: Entity — Severity: P1
- Detail: `LayoutStyle` holds visual attrs (bg, border, opacity) alongside layout; `CellStyle` holds glyph-level visual attrs; raw SGR escape strings are passed as `panelStyle`/`titleStyle` props. Three uncoordinated style entities.

**100. No `Theme` entity**
- File: `src/layout/types.ts:163`
- Dimension: Entity — Severity: P1
- Detail: Themed colors leak through `userContext: unknown` and ad-hoc raw SGR string props. SelectList's comments explicitly admit this gap.

**101. No named `FocusManager`/`FocusScope`**
- File: `src/tui.ts`
- Dimension: Entity — Severity: P2
- Detail: Focus state sprinkled across TUI, Focusable, focusScope flag.

**102. No `Cursor` entity**
- File: `src/tui.ts`
- Dimension: Entity — Severity: P2
- Detail: Cursor row/positioning lives as ad-hoc TUI fields.

**103. No `EventRouter`**
- File: `src/tui.ts`
- Dimension: Entity — Severity: P2
- Detail: Routing logic inline in `tui.ts`, not a named entity.

**104. `EventContext` duplicates `RenderContext`**
- File: `src/layout/types.ts:151,169`
- Dimension: Entity — Severity: P2
- Detail: Should share a base or extend.

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

**139. Clean one-file-per-tool**
- File: `src/`
- Dimension: Architecture — Severity: (info)
- Detail: Each tool file is self-contained: imports `Tool` type, the two arg helpers, and (for fs tools) `sanitizePath`. No cross-tool imports.

**140. `sanitizePath` earns its place**
- File: `src/utils.ts:17`
- Dimension: Architecture — Severity: (info)
- Detail: Used by 4/5 tools with identical semantics (quote stripping, cwd resolution, optional containment).

**141. Mild per-tool error-shaping duplication**
- File: `src/read-file.ts:17-25`, etc.
- Dimension: Architecture — Severity: P2
- Detail: Each fs tool repeats `sanitizePath → null check → existsSync → try/catch → formatError` shape.

**142. Permission `matchKey` missing**
- File: `packages/core/src/types/Tool.ts:1-8`
- Dimension: Architecture — Severity: P1
- Detail: Repo brief says each tool needs a "permission `matchKey`", but `Tool` has only `name/description/parameters/execute/onError/systemPrompt`. No tool here exports a permission descriptor.

**143. `bash` is the outlier**
- File: `src/bash.ts`
- Dimension: Architecture — Severity: P1
- Detail: No `sanitizePath`, no `restrictToCwd`, hard-coded 120s timeout, no `cwd` validation. `restrictToCwd` is a half-promise — paths constrained, but `bash` can `cd ..` freely.

**144. `getCwd` injection good design**
- File: All factories
- Dimension: Architecture — Severity: (info)
- Detail: Lets host swap working directory per session without restarting tools.

### Responsibilities

**145. Coherent fs+shell bundle**
- File: `src/`
- Dimension: Responsibilities — Severity: (info)
- Detail: Five tools share single organizing concept: "things an agent does to host's local environment, sandboxed to one cwd." Don't split.

**146. `formatError`/`parseArgs` re-export blurs ownership — DONE**
- File: `src/utils.ts:3`
- Dimension: Responsibilities — Severity: P2
- Detail: Re-exports from `mu-core`. Could drop re-export and have call sites import directly.

**147. `sanitizePath` could hoist if needed**
- File: `src/utils.ts`
- Dimension: Responsibilities — Severity: P2
- Detail: Only genuinely shareable helper. Hoist to mu-core if a 2nd tools package ever needs it.

### Types

**148. Per-tool `as T` casts without runtime guards**
- File: `src/read-file.ts:62-67`, `src/edit-file.ts:32-38`, `src/write-file.ts:27-32`, `src/list-dir.ts:56-70`, `src/bash.ts:81`
- Dimension: Types — Severity: P1
- Detail: `parsed.x as T` everywhere. Each tool re-asserts schema invariants in TS without runtime check.

**149. `bash` no runtime guard on `cmd`**
- File: `src/bash.ts:81`
- Dimension: Types — Severity: P1
- Detail: `parsed.cmd as string`. If LLM sends `{ cmd: 123 }`, cast silently lies and downstream `spawn` coerces.

**150. JSON schemas inline + untyped**
- File: All factories
- Dimension: Types — Severity: P1
- Detail: `parameters: Record<string, unknown>` from core. Schema authors get zero IDE feedback; typos like `type: 'intger'` compile.

**151. Result type is `string` everywhere**
- File: All factories
- Dimension: Types — Severity: P1
- Detail: Errors encoded as `"Error: ..."` strings. No discriminated union `{ ok: true; data } | { ok: false; error }`.

**152. `restrictToCwd: boolean` single flag**
- File: `src/index.ts:24`
- Dimension: Types — Severity: P2
- Detail: No allowlist, no per-tool override, no glob — can't express "bash allowed but only `git *`" or "read allowed outside cwd, write restricted".

**153. `MuToolName` hand-maintained, 3 places to align — DONE**
- File: `src/index.ts:17`
- Dimension: Types — Severity: P2
- Detail: String literal union separate from switch at lines 39-43 and from `name: 'read'` strings inside each factory.

**154. `*ToolOptions` interfaces file-local — DONE**
- File: `src/read-file.ts:5`, `src/bash.ts:62`, etc.
- Dimension: Types — Severity: P2
- Detail: Consumers can't reference shapes when building wrappers.

### Entities

**155. No package-defined entities**
- File: `src/`
- Dimension: Entity — Severity: (info)
- Detail: Reuses `Tool` from `mu-core`; returns plain `string` results.

**156. Near-duplicate `*ToolOptions` shapes**
- File: 4 fs tool option interfaces
- Dimension: Entity — Severity: P2
- Detail: All redeclare `{ getCwd; restrictToCwd? }`. `BashToolOptions` is a fifth near-duplicate.

**157. No `ToolResult`/`ToolError` discriminated union**
- File: All factories
- Dimension: Entity — Severity: P1
- Detail: Two error channels (execute return string + onError return different format), no shared discriminated union.

**158. `read` argument conflation**
- File: `src/read-file.ts:74-78`
- Dimension: Entity — Severity: P2
- Detail: `path: string | string[]` overloads single-file and batch reads under one parameter.

**159. `list_dir` rendering inseparable from data**
- File: `src/list-dir.ts:11-37`
- Dimension: Entity — Severity: P1
- Detail: Returns rendered tree string with emoji icons. No `DirEntry`/`FileEntry` type.

**160. `bash` no `ShellResult`**
- File: `src/bash.ts:37-53`
- Dimension: Entity — Severity: P1
- Detail: stdout/stderr/exitCode/timedOut flattened into one string. Non-zero exit with output indistinguishable from success.

**161. `edit` no `MatchKey` entity**
- File: `src/edit-file.ts`
- Dimension: Entity — Severity: P2
- Detail: Uniqueness checked inline by `split().length - 1`.

**162. No `Permission` entity**
- File: All tools
- Dimension: Entity — Severity: P1
- Detail: Containment is a boolean (`restrictToCwd`) threaded through `sanitizePath`. `bash` silently skips this check — asymmetric, undocumented "permission" boundary.

**163. Missing entities**
- Dimension: Entity — Severity: P1
- Detail: ToolFactoryOptions/ExecutionContext, ToolResult/ToolError, FileEntry/DirEntry, ShellResult, PathPermission, EditMatch, ReadRequest single vs batch.

### Simplifications

**164. `MuToolName` no external import — DONE**
- File: `src/index.ts:17`
- Dimension: Simplification — Severity: P1
- Detail: Only consumer is `DEFAULT_TOOLS`.

**165. `tools` subset option unused — DONE**
- File: `src/index.ts:23-26,28,36`
- Dimension: Simplification — Severity: P1
- Detail: No caller filters tools; tree-shaking handles "don't ship what you don't want".

**166. `restrictToCwd` never set true**
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

**178. `backends/` is half-built abstraction**
- File: `src/backends/`, `src/index.ts`
- Dimension: Architecture — Severity: P1
- Detail: Detector array shaped for N backends, but `LocalBackendKind = 'llama-swap'` is a single-member union. `index.ts:291,374,394` hardcode `backend.kind === 'llama-swap'`.

**179. SSE/orchestration fused in 437-line factory**
- File: `src/index.ts:303-416`
- Dimension: Architecture — Severity: P2
- Detail: `streamCompletion` handles stream consumption, delta routing, reasoning extraction, tool-call buffering, fallback emission, post-stream context collection, token counting, final `done` assembly.

**180. ~120 LOC context-map building inside provider**
- File: `src/index.ts:136-252`
- Dimension: Architecture — Severity: P1
- Detail: `buildContextMap`, `aggregateBuckets`, `countBucketTokens`, `labelContextPart` — provider-agnostic logic that any provider would re-implement.

**181. Llama-swap leaks into "Local"-named types**
- File: `src/types.ts:18`
- Dimension: Architecture — Severity: P2
- Detail: `LocalLLMResponseContext` embeds llama-swap slot/props concepts.

**182. Test-only mutation global — DONE**
- File: `src/index.ts:46`
- Dimension: Architecture — Severity: P2
- Detail: `setOpenAIClientForTesting` module-level mutable hook. DI parameter cleaner.

**183. Clean dependency direction**
- File: All
- Dimension: Architecture — Severity: (info)
- Detail: No cycles, no reverse deps.

### Responsibilities

**184. Context-map computation belongs in mu-core**
- File: `src/index.ts:146-252`
- Dimension: Responsibilities — Severity: P1
- Detail: None of this is local-specific; bucketing messages by role/tool kind and labeling parts is reusable across every provider.

**185. `listLocalModels`/`detectLocalBackend` belong in coding-agent/arya**
- File: `src/index.ts:52-89`
- Dimension: Responsibilities — Severity: P1
- Detail: These are picker-UX features that don't belong on the provider hot path.

**186. `toolContextKind` heuristics leak host knowledge**
- File: `src/index.ts:146-151`
- Dimension: Responsibilities — Severity: P1
- Detail: Hard-codes name-pattern heuristics ("mcp_", "skill") about consumers the provider has no business knowing about.

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

**194. `requestOptions: Record<string, unknown>`**
- File: `src/index.ts:281-287`
- Dimension: Types — Severity: P2
- Detail: Strongly-typed `messages`/`tools` widened immediately.

**195. `LocalBackendKind` single-member union**
- File: `src/types.ts:3`
- Dimension: Types — Severity: P1
- Detail: `'llama-swap'` only. Will hurt as backends land.

**196. `LocalLLMResponseContext` leaks backend shape**
- File: `src/types.ts:18`
- Dimension: Types — Severity: P2
- Detail: Extends `LLMResponseContext` with `props`, `slots`, `currentSlot`. Discriminated union problem when second backend lands.

### Entities

**197. No `Backend` interface despite registry**
- File: `src/index.ts:50, 291, 374`
- Dimension: Entity — Severity: P1
- Detail: Detector registry exists but request preparation lives as free functions hard-coded to llama-swap.

**198. Three parallel tool-call representations**
- File: `src/index.ts:306-358,383-392`
- Dimension: Entity — Severity: P1
- Detail: OpenAI delta, internal buffer map, mu-core `ToolCall` — same data, three shapes.

**199. No `ProviderError`**
- File: `src/index.ts:66, 79, 267`
- Dimension: Entity — Severity: P2
- Detail: Failures are raw `Error` with formatted strings.

**200. `LocalBackendInfo` conflates identity with snapshot**
- File: `src/types.ts:31-38`, `src/index.ts:255`
- Dimension: Entity — Severity: P2
- Detail: Identity (kind+url) and snapshot state (`models`) — model list goes stale immediately yet cached on `backendPromise`.

**201. `LocalProviderConfig.model` optional but required**
- File: `src/types.ts:43`, `src/index.ts:266`
- Dimension: Entity — Severity: P2
- Detail: Operationally required; semantics unclear.

**202. Missing entities**
- Dimension: Entity — Severity: P1
- Detail: Backend, ProviderError, ChatRequest/ChatResponse, ToolCallBuffer (named), ModelDescriptor distinct from LocalModel.

### Simplifications

**203. `estimateJsonTokens` dead — DONE**
- File: `src/index.ts:142-144`
- Dimension: Simplification — Severity: P1
- Detail: Defined but never called.

**204. `setOpenAIClientForTesting` global mutation**
- File: `src/index.ts:46-48`
- Dimension: Simplification — Severity: P2
- Detail: Test-only; inject via constructor option.

**205. `backendDetectors` array of one — DONE**
- File: `src/index.ts:50`
- Dimension: Simplification — Severity: P1
- Detail: Inline `detectLlamaSwap` directly.

**206. Multi-backend dance dead**
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

**214. Runtime AbortSignal not threaded — PARTIAL (timeout AbortController properly wired; full executor-signal threading awaits `Tool.execute` signature change in mu-core)**
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

**221. Single-file plugin clean for size**
- File: `src/plugin.ts`
- Dimension: Architecture — Severity: (info)

**222. mu-core dep minimal**
- File: `src/plugin.ts:13`
- Dimension: Architecture — Severity: (info)
- Detail: Only `Plugin`, `Tool`, `formatError`, `parseArgs`.

**223. Pipeline stages not modules**
- File: `src/plugin.ts:218-247`
- Dimension: Architecture — Severity: P2
- Detail: `runWebFetch → fetchWithCloudflareRetry → readBoundedBuffer → renderBody/imageDataUrl` exist as functions, not modules. Render layer not reusable.

**224. Format dispatch not decoupled**
- File: `src/plugin.ts:33, 121, 210`
- Dimension: Architecture — Severity: P2
- Detail: `format` influences `buildAcceptHeader`, `renderBody`, `pickFormat`. Adding format = editing all three.

**225. Image bypasses format pipeline**
- File: `src/plugin.ts:242`
- Dimension: Architecture — Severity: P2
- Detail: `format=html` on an image still returns data-URL.

**226. No public re-exports**
- File: `src/plugin.ts`
- Dimension: Architecture — Severity: P2
- Detail: `convertHtmlToMarkdown`, `extractTextFromHtml` file-private. Arya can't reuse render layer.

### Responsibilities

**227. Separation from mu-tools justified**
- File: package.json
- Dimension: Responsibilities — Severity: (info)
- Detail: Trust boundary (network egress vs local fs/shell), dep weight (`turndown`), plugin shape difference.

**228. Natural home for future web_search**
- Dimension: Responsibilities — Severity: P1
- Detail: Trust boundary already matches.

**229. README should say "markdown-first" — DONE**
- File: package.json
- Dimension: Responsibilities — Severity: P1
- Detail: Description ("returns it as text") should reflect markdown default.

### Types

**230. `WebFetchFormat` private**
- File: `src/plugin.ts:23`
- Dimension: Types — Severity: P1
- Detail: JSON-schema enum and runtime `pickFormat` repeat same literals.

**231. Untyped tool args**
- File: `src/plugin.ts:218`
- Dimension: Types — Severity: P1
- Detail: `runWebFetch(args: Record<string, unknown>)`. Schema declares fields, execute receives unknown.

**232. Four `any` casts around HTMLRewriter**
- File: `src/plugin.ts:82, 93, 104, 107`
- Dimension: Types — Severity: P1
- Detail: `HTMLRewriter`, `rewriter: any`, `element(el: any)`, `text(t: any)`.

**233. Turndown options inline — DONE**
- File: `src/plugin.ts:67`
- Dimension: Types — Severity: P2
- Detail: Buried in function body; not lifted to typed constant.

**234. Flat `string` return**
- File: `src/plugin.ts:210`
- Dimension: Types — Severity: P1
- Detail: `renderBody` returns `Promise<string>` for image/markdown/text/html alike. No discriminated output.

**235. `'error' in attempt` instead of `!attempt.ok` — DONE**
- File: `src/plugin.ts:229, 236`
- Dimension: Types — Severity: P2
- Detail: Discriminant exists; use it.

**236. No exported types**
- File: `src/plugin.ts`
- Dimension: Types — Severity: P1
- Detail: Only `createWebFetchTool()` and default `Plugin`. No `WebFetchFormat`/`WebFetchArgs`/`WebFetchResult`.

### Entities

**237. Bare `string` return collapses everything**
- File: `src/plugin.ts:218, 275`
- Dimension: Entity — Severity: P1
- Detail: Success, errors, image data-URLs indistinguishable.

**238. HTTP metadata discarded**
- File: `src/plugin.ts:231, 177, 239`
- Dimension: Entity — Severity: P1
- Detail: Status, headers, final URL after redirects, content-length all discarded.

**239. `content-type`/`mime` not entities**
- File: `src/plugin.ts:239-240`
- Dimension: Entity — Severity: P2
- Detail: Local strings.

**240. No raw/converted split**
- File: `src/plugin.ts:210`
- Dimension: Entity — Severity: P1
- Detail: `renderBody` folds format selection, HTML detection, and conversion.

**241. `format` is a flag**
- File: `src/plugin.ts:23`
- Dimension: Entity — Severity: P2
- Detail: Conflates request intent and rendering policy.

**242. No `FetchError` discriminator**
- File: `src/plugin.ts:146, 179`
- Dimension: Entity — Severity: P1
- Detail: Errors flattened to `formatError(string)`. No timeout vs size-cap vs HTTP-status vs network.

**243. Missing entities**
- Dimension: Entity — Severity: P1
- Detail: FetchResult, FetchError (tagged), RawResponse vs RenderedOutput, ImagePayload, FetchOptions/FetchRequest.

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

**260. `bin/` thin and clean**
- File: `bin/coding-agent.ts`
- Dimension: Architecture — Severity: (info)
- Detail: Handles CLI dispatch, provider plumbing, config gating.

**261. `ChatApp.ts` 1608-line god-class**
- File: `src/ui/ChatApp.ts`
- Dimension: Architecture — Severity: P1
- Detail: Owns input routing, slash-command dispatch, file picker, command palette, modal state, history, sub-agent dispatch+framing, transcript rendering, status spinner, override-clear polling, bash mode, CoreEvent handling.

**262. No single-shot code path**
- File: `bin/coding-agent.ts`, `src/main.ts`
- Dimension: Architecture — Severity: P1
- Detail: Only interactive `ChatApp.start()`. No headless/single-prompt runner sharing core wiring.

**263. Sub-agent dispatch logic leaks into UI**
- File: `src/ui/ChatApp.ts:548-613`
- Dimension: Architecture — Severity: P2
- Detail: `dispatchSubAgentRun` coordinates run store, primary feedback, reply formatting — business logic in TUI class.

**264. Dual state ownership**
- File: `bin/coding-agent.ts:124-137`, `src/main.ts:60-71`
- Dimension: Architecture — Severity: P2
- Detail: Both translate primary-agent changes and persist state, with `main.ts` re-implementing find-by-name on top of bin's closures.

**265. Slash commands hard-coded**
- File: `src/ui/ChatApp.ts:913-923`
- Dimension: Architecture — Severity: P2
- Detail: `createCommands()` is a fixed array. No plugin/extension point.

**266. Dependency direction healthy**
- File: All
- Dimension: Architecture — Severity: (info)
- Detail: No cycles, no internal reach-around.

**267. `host-config.ts` dead — DONE**
- File: `src/host-config.ts`
- Dimension: Architecture — Severity: P2
- Detail: `buildHostConfig` exported but unreferenced.

### Responsibilities

**268. `src/ui/` could be `mu-chat-ui` package**
- File: `src/ui/components/`, `src/ui/theme/`, etc.
- Dimension: Responsibilities — Severity: P1
- Detail: ChatApp, AssistantMessage, UserMessage, ToolLine, ContextMap, ReasoningBlock, OutputBlock, theme system — generic chat primitives.

**269. Sub-agent dispatch wiring could move to harness**
- File: `bin/coding-agent.ts:139-151`, `src/main.ts:31-83`
- Dimension: Responsibilities — Severity: P2
- Detail: Every host wiring `bootstrap({ getActivePrimary })` will rewrite this.

**270. Ad-hoc CLI parsing**
- File: `bin/coding-agent.ts:18-28`
- Dimension: Responsibilities — Severity: P2
- Detail: Just positional `argv.slice(2)`. No `--help`/`--version`.

**271. ChatApp extraction pressure**
- File: `src/ui/ChatApp.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: 1608 lines — input handling, palette, file picker, sub-agent views, modal, history, deferred-command queue all collapsed into one class.

### Types

**272. CLI argv untyped**
- File: `bin/coding-agent.ts:18`
- Dimension: Types — Severity: P2
- Detail: `const [cmd, arg] = process.argv.slice(2)`. Pure positional destructuring.

**273. Anonymous providerConfig shape**
- File: `bin/coding-agent.ts:49-53`
- Dimension: Types — Severity: P2
- Detail: Inline `{ kind?; baseUrl; model; apiKey? }`, narrowed with `as LocalBackendKind | undefined` on string from JSON.

**274. `savePartialState` widens to full state**
- File: `src/main.ts:34`
- Dimension: Types — Severity: P2
- Detail: `(patch: typeof state)` should be `Partial<CodingAgentState>`.

**275. `AgentDisplay` redeclared 3 times**
- File: `src/main.ts:46`, `src/ui/ChatApp.ts:44`, harness `SubAgent`
- Dimension: Types — Severity: P1
- Detail: Three near-duplicates between harness, main, ChatApp.

**276. `ChatBus` locally re-shaped**
- File: `src/ui/ChatApp.ts:27-29`
- Dimension: Types — Severity: P2
- Detail: Re-typing mu-core Bus narrows it (no unsubscribe-all, no event narrowing).

**277. `as `#${string}`` color cast**
- File: `src/ui/ChatApp.ts:422`, `src/ui/components/SubAgentPreview.ts:55`
- Dimension: Types — Severity: P2
- Detail: Casts a `string` to hex literal type after runtime `startsWith('#')` check.

**278. `LayoutStyle.height as number` cast**
- File: `src/ui/ChatApp.ts:801-804`
- Dimension: Types — Severity: P2
- Detail: Casts away `'fill' | 'auto' | number` union.

**279. `classifyMention` not discriminated**
- File: `src/ui/ChatApp.ts:524`
- Dimension: Types — Severity: P2
- Detail: Returns open object `{ kind; agent?; task? }`.

**280. Three spellings of "queue mode"**
- File: `src/ui/Transcript.ts:6-15`
- Dimension: Types — Severity: P1
- Detail: `ChatLine.label` uses 'queued steering'|'follow-up'; `WaitingItem.kind` uses 'steering'|'follow_up'; `Transcript.appendQueuedMessage` takes 'steering'|'follow_up'.

**281. `summariseMessage` dead with unused param — DONE**
- File: `src/ui/subAgentRun.ts:159`
- Dimension: Types — Severity: P2
- Detail: Returns `''`, never called.

**282. ToolLine JSON parse weak typing**
- File: `src/ui/components/ToolLine.ts:31-55`
- Dimension: Types — Severity: P2
- Detail: `JSON.parse(rawArgs) as Record<string, unknown>`, then literal name checks.

**283. `loadJson<T>` not used everywhere**
- File: `src/config.ts:21-32`
- Dimension: Types — Severity: P2
- Detail: `loadHistory` and `exportContext` JSON skip the validator pattern.

**284. `getTheme` duck-typing**
- File: `src/ui/theme/theme.ts:130-136`
- Dimension: Types — Severity: P2
- Detail: `'colors' in value && 'styles' in value && 'name' in value` then `as Theme` cast.

### Entities

**285. `ChatApp` god-object**
- File: `src/ui/ChatApp.ts:85-145`
- Dimension: Entity — Severity: P1
- Detail: Toast state, modal state, command palette state, file picker state, history navigation, override-agent state, spinner, sub-agent view state — all loose fields.

**286. `activeAgent` phantom in persisted state**
- File: `src/config.ts:18`, `src/main.ts`
- Dimension: Entity — Severity: P2
- Detail: Written by harness but never read in `main.ts`.

**287. `AgentDisplay` duplicates `SubAgent`**
- File: `src/main.ts:46`
- Dimension: Entity — Severity: P1
- Detail: `toDisplay` projects per call.

**288. `ChatLine` mixes data with UI components**
- File: `src/ui/Transcript.ts:11`
- Dimension: Entity — Severity: P1
- Detail: `output_block` carries a live `OutputBlock` instance. Breaks persisted/transient boundary.

**289. `summariseMessage` phantom**
- File: `src/ui/subAgentRun.ts:159`
- Dimension: Entity — Severity: P2
- Detail: Returns `''`, never called.

**290. `MainOptions` half-entity, half-callback bag**
- File: `src/main.ts:6-29`
- Dimension: Entity — Severity: P2
- Detail: Override/active primary trio could be `PrimaryAgentController` entity.

**291. `RoundtripStore` owns derived alongside source**
- File: `src/ui/ChatApp.ts`
- Dimension: Entity — Severity: P2
- Detail: `contextText` (derived) held as sibling field.

**292. Missing entities**
- Dimension: Entity — Severity: P1
- Detail: ChatViewState (or split: ToastState, ModalState, CommandPaletteState, FilePickerState, HistoryNavigator, OverrideAgentState), PrimaryAgentController, DeferredCommand, MentionRouting, SessionLifecycle.

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

**297. FilePicker back-compat exports unused — PARTIAL (removed `invalidateTreeCache` + `fuzzyFilter`; `FilePickerEntry` alias kept because `ChatApp` actually uses it)**
- File: `src/ui/components/FilePicker.ts:18-19, 75-78, 122-125`
- Dimension: Simplification — Severity: P1
- Detail: `FilePickerEntry` alias, `invalidateTreeCache`, `fuzzyFilter` — zero callers.

**298. `CodingAgentConfig` provider fields**
- File: `src/config.ts:8, 9, 11`
- Dimension: Simplification — Severity: P2
- Detail: `kind`, `baseUrl`, `provider` belong to local-provider config.

**299. `ModalMode` single-value union — DONE**
- File: `src/ui/ChatApp.ts:81`
- Dimension: Simplification — Severity: P2
- Detail: `type ModalMode = 'model'`. Collapse to boolean. `interceptModalInput` else-branch unreachable.

**300. `output_block` ChatLine arm one-off**
- File: `src/ui/Transcript.ts`
- Dimension: Simplification — Severity: P2
- Detail: Wraps OutputBlock component reference; pattern is one-off.

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

**312. Plugin loader runs arbitrary code on boot — PARTIAL (manifest gate + traversal block + load logging added; full sandbox/trust-prompt deferred)**
- File: `src/plugin-loader.ts:58-71`
- Dimension: Bug — Severity: P1 (security)
- Detail: Any `.ts/.js/.mts/.mjs` file in `<dataDir>/plugins` is dynamically `import()`-ed on boot. Top-level side effects run before `validatePlugin`. No signature, no sandbox.

**313. Unanchored npm spec regex — DONE**
- File: `src/plugin-loader.ts:50-52`
- Dimension: Bug — Severity: P2
- Detail: `isAllowedSpec` regex `/^@[\w-]+\/[\w.-]+/` is not anchored. `npm:` branch accepts any string starting with `npm:`.

**314. Scheduler crash on bad cron — DONE**
- File: `src/scheduler/plugin.ts:48-50, 66`
- Dimension: Bug — Severity: P2
- Detail: `new Cron(task.cron, ...)` throws synchronously on invalid cron strings; no try/catch around `scheduleTask`. One malformed line kills scheduler start.

**315. Cron-fired prompts have no provenance — PARTIAL (TODO documented at cron-publish site; full fix requires mu-core CoreEvent extension)**
- File: `src/scheduler/plugin.ts:70`
- Dimension: Bug — Severity: P2 (security)
- Detail: Scheduled tasks publish `user_message` directly. Permission rules can't distinguish "user typed this" from "cron fired".

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
- Direction: harness is the intended base for channels/mentions/scheduler. Port coding-agent onto `bootstrap()` rather than treat the orphan status as evidence to delete. See [[feedback-harness-role]].

**320. `channels/tui.ts` reimplements slash detection**
- File: `src/channels/tui.ts:62-66`, `src/commands/registry.ts:51-55`
- Dimension: Architecture — Severity: P2
- Detail: Both own slash-detection logic.
- Direction: dedupe internally in harness; coding-agent should consume the Channel-side slash detection rather than building its own. See [[feedback-harness-role]].

**321. `bootstrap.ts` is 300-line god function**
- File: `src/bootstrap.ts`
- Dimension: Architecture — Severity: P1
- Detail: 11 numbered steps. Steps 4-5 (permissions+approvals+hook) and 9 (tools+subagent injection) deserve dedicated factories.

**322. Sub-agent runner re-spins runtime**
- File: `src/sub-agents/runner.ts:82-92`
- Dimension: Architecture — Severity: P2
- Detail: Calls `createBus`, `createInMemorySessionStore`, `createRuntime` directly instead of using `createAgentRuntime`. Two runtime construction paths.
- Direction: collapse onto `createAgentRuntime` so sub-agent and primary share the same harness wiring.

**323. Two session-store contracts side-by-side**
- File: `src/sessions/types.ts`, `src/bootstrap.ts:111`
- Dimension: Architecture — Severity: P2
- Detail: mu-core's `SessionStore` and harness's `PersistedSessionStore` extension. Bootstrap returns base type even when persistent — requires downcast.

**324. Public API flat (50+ symbols)**
- File: `src/index.ts`
- Dimension: Architecture — Severity: P1
- Detail: Mandatory wiring next to optional utilities next to not-yet-used scaffolding.

**325. No package-level re-export grouping**
- File: `src/index.ts`
- Dimension: Architecture — Severity: P2
- Detail: All exports inlined; subfolders don't have own barrels.

### Responsibilities

**326. Coherent core**
- File: `src/`
- Dimension: Responsibilities — Severity: (info)
- Detail: bootstrap+permissions+approvals+skills+sub-agents+sessions+plugin-loader work together; permissions↔approvals coupling justifies bundling.

**327. `channels/mentions/scheduler/` should move out — REJECTED**
- File: `src/channels/`, `src/mentions/`, `src/scheduler/`
- Dimension: Responsibilities — Severity: P1
- Detail: Zero in-repo consumers; arya bypasses channels with its own WS layer.
- Decision: KEEP in harness. These are the intended shared base for both coding-agent and arya. The lack of consumers is the wiring gap to close (#319, #320, #322, #409), not evidence of dead code. See [[feedback-harness-role]].

**328. `plugins/installer.ts` could move**
- File: `src/plugins/installer.ts`
- Dimension: Responsibilities — Severity: P2
- Detail: Install-time CLI helper, not runtime orchestration. Better in `mu-cli` or coding-agent.

**329. `bootstrap()` boundary undocumented**
- File: `src/bootstrap.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: Decide: port coding-agent onto it OR delete the orchestrator.

**330. No tests for bootstrap**
- File: `src/bootstrap.ts`
- Dimension: Responsibilities — Severity: P1
- Detail: 300-line orchestrator, untested.

### Types

**331. PermissionRule single glob**
- File: `src/permissions/types.ts:11`
- Dimension: Types — Severity: P1
- Detail: `argsPattern?: string` — args is a single glob over `JSON.stringify(args)`. No structured rule shape (path, env, host).

**332. `PermissionCheck.args: string`**
- File: `src/permissions/types.ts:22`
- Dimension: Types — Severity: P2
- Detail: Stringified blob.

**333. `PermissionPrompt`/`ApprovalDecision` mismatch**
- File: `src/permissions/hook.ts:10`, `src/approvals/queue.ts:20`
- Dimension: Types — Severity: P2
- Detail: Bare literals vs named alias.

**334. `ApprovalRequest.id: unbranded string`**
- File: `src/approvals/queue.ts:13`
- Dimension: Types — Severity: P1
- Detail: Should be `ApprovalRequestId` (branded).

**335. `parseArgs` silent fallback — DONE**
- File: `src/sub-agents/tool.ts:42, 149, 161`
- Dimension: Types — Severity: P2
- Detail: Falls back to `{ agent: '', task: '' }` on JSON.parse failure.

**336. `SubAgentRunResult.error?` sentinel**
- File: `src/sub-agents/runner.ts:58`
- Dimension: Types — Severity: P1
- Detail: Should be discriminated union `{ status: 'ok', content } | { status: 'failed', error, partialContent? }`.

**337. Channel error: unknown too wide**
- File: `src/channels/types.ts`
- Dimension: Types — Severity: P2
- Detail: Renderers can't dispatch on it.

**338. `Channel.kind: string`**
- File: `src/channels/types.ts:38`
- Dimension: Types — Severity: P2
- Detail: Should be string-literal-extensible union.

**339. `Command<TArgs,TCtx>` generics lost**
- File: `src/commands/types.ts:21-23`
- Dimension: Types — Severity: P1
- Detail: `parseArgs?: (raw: string) => unknown` then `run: (args: unknown, ctx: Record<string, unknown>) => …`.

**340. `CommandResult.output?: unknown`**
- File: `src/commands/types.ts:3`
- Dimension: Types — Severity: P2
- Detail: Forces every TUI renderer to coerce via `String(...)`.

**341. `MentionResolver` not generic**
- File: `src/mentions/types.ts:6, 17`
- Dimension: Types — Severity: P2
- Detail: `payload?: unknown` and `ctx: Record<string, unknown>`.

**342. Session ids unbranded**
- File: `src/sessions/types.ts:5-11`
- Dimension: Types — Severity: P1
- Detail: No `SessionId` brand to prevent mixing with `AgentId`/`RoundtripId`.

**343. `as Message` / `as Meta` casts**
- File: `src/sessions/jsonl-store.ts:50, 61`
- Dimension: Types — Severity: P1
- Detail: `JSON.parse(line) as Message` — no validation.

**344. SchedulerTask weak strings**
- File: `src/scheduler/plugin.ts:23-29`
- Dimension: Types — Severity: P2
- Detail: `cron: string`, `timezone?: string`, `id: string`, `channel?: string`.

**345. `validatePlugin` uses `as` after duck-typing**
- File: `src/plugin-loader.ts:25`
- Dimension: Types — Severity: P1
- Detail: No manifest type. Returns `Plugin` via cast.

**346. Frontmatter freeform**
- File: `src/markdown.ts:5`
- Dimension: Types — Severity: P2
- Detail: `Record<string, unknown>` — every consumer hand-rolls validation.

**347. `Model.id: unbranded string`**
- File: `src/agent-runtime.ts:14-19`
- Dimension: Types — Severity: P1
- Detail: Should be `ModelId` (used through commands, runtime, listModels).

**348. Runtime inferred shape leaks**
- File: `src/agent-runtime.ts:23`
- Dimension: Types — Severity: P2
- Detail: `runtime: ReturnType<typeof createCoreRuntime>` exposes inferred shape.

**349. `extraCommands` couples tightly**
- File: `src/bootstrap.ts:92`
- Dimension: Types — Severity: P2
- Detail: `extraCommands?: ReturnType<CommandRegistry['list']>` obscures contract.

**350. Roundtrip index unbranded**
- File: `src/roundtrips.ts:3`
- Dimension: Types — Severity: P2
- Detail: Could be `RoundtripIndex`.

**351. Missing branded id types**
- Dimension: Types — Severity: P1
- Detail: AgentId, SessionId, ModelId, TaskId, RoundtripIndex, ChannelId — none branded.

### Entities

**352. `SubAgent` conflates roles**
- File: `src/sub-agents/types.ts:3`, `src/bootstrap.ts:164-167`
- Dimension: Entity — Severity: P1
- Detail: One shape carries primary persona that drives root runtime AND delegatable worker via `subagent` tool. Discriminator field `type` is the only differentiator.

**353. No stable ids (name is primary key)**
- File: `src/sub-agents/loader.ts:28`, `src/commands/registry.ts:25`
- Dimension: Entity — Severity: P2
- Detail: SubAgent, Skill, Command, Channel, MentionResolver all use `name`. No separate `id`.

**354. `AgentRuntime` thin wrapper**
- File: `src/agent-runtime.ts:21`
- Dimension: Entity — Severity: P2
- Detail: Adds Model state + re-create function around core `Runtime`. Not a domain entity. Rename `SessionManager` or fold into bootstrap.

**355. `HostConfig` anaemic**
- File: `src/host-config.ts:10`
- Dimension: Entity — Severity: P2
- Detail: 4 string arrays + a name. Used once in bootstrap.

**356. `Roundtrip` lifecycle unclear**
- File: `src/roundtrips.ts:3, 18`
- Dimension: Entity — Severity: P2
- Detail: In memory only, no link to Session/transcript. Relationship to core's `LLMResponseContext` unwritten.

**357. `ApprovalRequest` lacks context**
- File: `src/approvals/queue.ts:12`
- Dimension: Entity — Severity: P1
- Detail: No session id, no requesting agent name, no channel — makes multi-channel/multi-session approval routing hard.

**358. `SchedulerTask.channel` dangling**
- File: `src/scheduler/plugin.ts:28, 70`
- Dimension: Entity — Severity: P2
- Detail: Field exists but no Channel coupling.

**359. `Mention` not an entity**
- File: `src/mentions/`
- Dimension: Entity — Severity: P2
- Detail: Only `ResolvedMention` exists.

**360. Missing registries/gateways**
- File: `src/`
- Dimension: Entity — Severity: P1
- Detail: SkillRegistry, SubAgentRegistry (skills/subagents are flat arrays), ApprovalGateway/PermissionGateway (wiring rebuilt twice in bootstrap + runner), PluginRegistry.

**361. AgentDefinition concept missing**
- Dimension: Entity — Severity: P1
- Detail: Mentioned in repo context but absent; `SubAgent` plays both roles.

**362. Channel session binding missing**
- File: `src/channels/`
- Dimension: Entity — Severity: P2
- Detail: No `ChannelSession` linking channelId ↔ sessionId. Hosts re-invent it.

**363. Phantom: parser inputs near-identical**
- File: `src/sub-agents/`, `src/skills/`
- Dimension: Entity — Severity: P2
- Detail: `SubAgentParseInput`, `SkillParseInput` almost identical.

**364. `SubAgentToolDeps` missing entity**
- File: `src/sub-agents/tool.ts:6`
- Dimension: Entity — Severity: P2
- Detail: Getter-bag with five `get*` closures — missing `AgentDispatcher` entity.

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

**370. Delete commands subsystem**
- File: `src/commands/`
- Dimension: Simplification — Severity: P1
- Detail: Coding-agent never accesses `result.commandRegistry`. Drop `extraCommands`/`skipDefaultCommands`/`commandRegistry` from bootstrap.

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

**374. `sessions/jsonl-store.ts` not used by coding-agent**
- File: `src/sessions/jsonl-store.ts`
- Dimension: Simplification — Severity: P1
- Detail: 285 lines. Coding-agent passes `sessionStore: 'memory'`. Either remove or move out.

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

**378. CommandRegistry alias map unused**
- File: `src/commands/registry.ts:16, 28-34, 41`
- Dimension: Simplification — Severity: P2
- Detail: No command in the repo defines aliases.

**379. `AgentRuntime` over-exposed — DONE**
- File: `src/agent-runtime.ts:62-113`
- Dimension: Simplification — Severity: P2
- Detail: Coding-agent uses 7 of 12 properties. `createRuntime(sessionId)`, `currentSession()`, `listModels`, `models` array, `model` getter, `onModelChange` can collapse.

**380. `HostConfig` wrapper unnecessary — DONE**
- File: `src/host-config.ts`
- Dimension: Simplification — Severity: P2
- Detail: 26-line wrapper around 4 string-arrays. Collapse to plain interface.

**381. Bootstrap static branching dead**
- File: `src/bootstrap.ts:167-264`
- Dimension: Simplification — Severity: P2
- Detail: Static path for hosts that don't pass `getActivePrimary`; coding-agent always passes one.

**382. `approvalQueueToPrompt` one-liner**
- File: `src/approvals/`
- Dimension: Simplification — Severity: P2
- Detail: `queue.request(call.tool, call.args, matched)`. Inline.

**383. `XdgPaths` over-declared — DONE**
- File: `src/paths/xdg.ts`
- Dimension: Simplification — Severity: P2
- Detail: Declares 18 path fields; coding-agent reads `pluginsDir`, `agentsDir`, `skillsDir`, `permissionsFile`.

**384. Subagent parser tool-arg shapes**
- File: `src/sub-agents/parser.ts:74-127`
- Dimension: Simplification — Severity: P2
- Detail: Array + comma-string + object forms; pick one.

**385. Dual primary-pick heuristic**
- File: `src/sub-agents/primary.ts:14-18`
- Dimension: Simplification — Severity: P2
- Detail: "Exactly one agent → it's primary" fallback adds magic. Require `type: primary`.

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

**398. 4 files, ~700 LOC**
- File: `src/`
- Dimension: Architecture — Severity: (info)
- Detail: Thin composition layer.

**399. README/PLAN drift — DONE**
- File: README.md, PLAN.md
- Dimension: Architecture — Severity: P1
- Detail: Parent README lists `ws-channel.ts`, `scheduler.ts`, `plugins/tools/{fs,shell,http}` — none exist in `src/`.

**400. Actually uses mu-tools + mu-webfetch**
- File: `src/bootstrap.ts:18-19, 96, 105`
- Dimension: Architecture — Severity: (info)
- Detail: fs/shell from `mu-tools`; http from `mu-webfetch`; scheduler from `mu-harness`.

**401. Layering sound**
- File: All
- Dimension: Architecture — Severity: (info)
- Detail: bin → index (CLI) → bootstrap (composition) → {harness orchestration, ws transport}.

**402. Zero tests**
- File: package
- Dimension: Architecture — Severity: P1
- Detail: `find` returns no test files.

**403. Scheduler post-attach undocumented**
- File: `src/bootstrap.ts:130-135`
- Dimension: Architecture — Severity: P2
- Detail: Pushed onto `result.plugins` after `harnessBootstrap` returns, before `createAgentRuntime`. Load-bearing but undocumented.

**404. Transport coupling leak**
- File: `src/ws.ts:46-49`
- Dimension: Architecture — Severity: P2
- Detail: `asPersistedStore` cast admits `AgentRuntime.store` is typed loosely.

**405. Public API hidden**
- File: package.json
- Dimension: Architecture — Severity: P2
- Detail: `bin` only — no `main`, no `exports`, no type publishing.

**406. `setInterval` idle-poll**
- File: `src/ws.ts:224-231`
- Dimension: Architecture — Severity: P2
- Detail: Should be event-driven from bus.

### Responsibilities

**407. arya correctly thin (no tool duplication)**
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

**410. Mobile protocol envelope arya-specific**
- File: `src/ws.ts`
- Dimension: Responsibilities — Severity: (info)
- Detail: sessions:list/create/delete/rename/get, approval token shape — product-specific.

### Types

**411. Server essentially untyped at wire boundary**
- File: `src/ws.ts:43,65,71,313`
- Dimension: Types — Severity: P1
- Detail: Every outbound payload is `Record<string, unknown>`.

**412. Inbound parsed loosely**
- File: `src/ws.ts:137-143`
- Dimension: Types — Severity: P1
- Detail: `Record<string, unknown>`, then `String(msg.type ?? '')`, `String(msg.text ?? '')`. No validation.

**413. `asPersistedStore` structural cast**
- File: `src/ws.ts:46-49`
- Dimension: Types — Severity: P2
- Detail: Gated only by code comment ("safe by construction").

**414. Bus event Parameters<...> trick**
- File: `src/ws.ts:106`
- Dimension: Types — Severity: P2
- Detail: `Parameters<Parameters<typeof bus.subscribe>[0]>[0]`. Harness doesn't export `CoreEvent`/`BusEvent`.

**415. Approval action bare string**
- File: `src/ws.ts:177-179`
- Dimension: Types — Severity: P1
- Detail: Only `'approve' | 'approve_always'` map to allow.

**416. Config hand-cast**
- File: `src/bootstrap.ts:42, 61-71`
- Dimension: Types — Severity: P1
- Detail: `Partial<BootstrapConfig>` + `result.baseUrl as string` after manual `missing[]` check. No schema.

**417. Scheduler event shape unknown**
- File: `src/bootstrap.ts:133`
- Dimension: Types — Severity: P2
- Detail: Emits `{ type: 'scheduler_event', event }` where `event` is `unknown`-shaped.

**418. Wire types duplicated, drifting**
- File: `src/ws.ts` vs `arya-companion/src/types/wire.ts`
- Dimension: Types — Severity: P1
- Detail: Companion has strict discriminated union; server has no shared types. Drift: server emits `activity` (not in companion union); companion expects `turn_start`/`active_agent`/`set_active_agent`/`sub_agent_event`/`scheduler_event`.
- Direction: resolved by #409 — once arya's WS is a harness Channel, the wire shape is defined once in harness, not duplicated on both sides. See [[feedback-harness-role]].

### Entities

**419. No `WebSocketSession` entity**
- File: `src/ws.ts:52`
- Dimension: Entity — Severity: P1
- Detail: Clients are `Set<WebSocket>`. No per-connection wrapper.

**420. Singleton `activeSessionId`**
- File: `src/ws.ts:57-58`
- Dimension: Entity — Severity: P1
- Detail: Concurrent clients trample each other.

**421. WS protocol messages not modeled**
- File: `src/ws.ts:147, 65-73`
- Dimension: Entity — Severity: P1
- Detail: Inbound + outbound built inline as `Record<string, unknown>`.

**422. Approval wire shape built twice**
- File: `src/ws.ts:256-263, 286-293`
- Dimension: Entity — Severity: P2
- Detail: Domain `PendingApproval` imported, but wire shape ad-hoc duplicated.

**423. Phantom scheduler_event**
- File: `src/bootstrap.ts:133`
- Dimension: Entity — Severity: P2
- Detail: No type/shape declared in arya.

**424. CommandManifest/AgentManifest anonymous**
- File: `src/ws.ts:233-239`
- Dimension: Entity — Severity: P2
- Detail: No shared contract with arya-companion.

**425. ScheduledTask not first-class**
- File: `definitions/tasks/`
- Dimension: Entity — Severity: P2
- Detail: Tasks live as YAML but directory empty. No `Running|Idle|Failed` over WS.

**426. `watchForIdle` polling not entity**
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

**430. `watchForIdle` polling smell**
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

**433. `commands`/`agents` requests redundant**
- File: `src/ws.ts:168-174, 251-252`
- Dimension: Simplification — Severity: P2
- Detail: Server pushes both on connect; inbound versions only needed for refresh.

**434. No tool duplication (premise wrong)**
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

**446. Clean Zustand store with strict writer**
- File: `src/state/store.ts`
- Dimension: Architecture — Severity: (info)
- Detail: Single Zustand store. `services/aryaClient` is the only writer. Hooks wrap selectors + intent. Documented at `store.ts:1-11`.

**447. No Tamagui (only NativeWind)**
- File: `package.json`
- Dimension: Architecture — Severity: (info)
- Detail: Brief was wrong — no Tamagui dep.

**448. `aryaClient.ts` 338 LOC mixing concerns**
- File: `src/services/aryaClient.ts`
- Dimension: Architecture — Severity: P1
- Detail: Lifecycle / outbound / dispatch.

**449. Transcripts Map global replacement**
- File: `src/state/store.ts:99-135`
- Dimension: Architecture — Severity: P1
- Detail: Any session update invalidates `useTranscript` for all sessions. Cross-session re-renders.

**450. `ThemeContext` dead infrastructure — DONE**
- File: `src/theme/ThemeContext.tsx`
- Dimension: Architecture — Severity: P2
- Detail: Hardcoded `darkTheme`, no `setTheme`. Provider has no dynamic value.

**451. `plugins/` is Expo config plugins (naming confusing)**
- File: `plugins/`
- Dimension: Architecture — Severity: P2
- Detail: Build-time, not runtime app plugins. Reader expecting runtime extensions gets confused.

### Responsibilities

**452. Sub-agent run aggregation belongs server-side**
- File: `src/services/snapshotReducers.ts:79-173`
- Dimension: Responsibilities — Severity: P1
- Detail: Reduces 5 `sub_agent_event` types into `SubAgentRunSnapshot`. Harness has this state. Every reconnect loses history.

**453. Approval snapshot lifecycle server-owned**
- File: `src/services/snapshotReducers.ts:29-53`, `src/services/aryaClient.ts:217-232`
- Dimension: Responsibilities — Severity: P1
- Detail: Authoritative on server's ApprovalQueue. Companion should mirror.

**454. `set_active_agent` half-implemented**
- File: `src/services/aryaClient.ts:151-160`, `src/types/wire.ts:121-127`
- Dimension: Responsibilities — Severity: P1
- Detail: Companion sends, expects echo. Server has no handler.

**455. Needs shared protocol package — SUPERSEDED**
- File: `src/types/wire.ts:33`
- Dimension: Responsibilities — Severity: P1
- Detail: Comment literally says "Mirrors mu-core's `Message`". Drift inevitable.
- Direction: a separate shared-protocol package isn't needed — the harness Channel API plays that role once arya's WS is ported (#409). Companion talks to a Channel; the wire shape lives in harness. See [[feedback-harness-role]].

**456. Server commands/agents responses UI-shaped**
- File: `src/types/wire.ts`
- Dimension: Responsibilities — Severity: P2
- Detail: `description`, `color` — fine, but cements coupling.

### Types

**457. Strong typing overall**
- File: `src/`
- Dimension: Types — Severity: (info)
- Detail: Zero `any`, strict mode, discriminated unions, exhaustive `never` check (`aryaClient.ts:333`).

**458. `as WsInboundMessage` cast bypasses validation**
- File: `src/services/aryaClient.ts:97`
- Dimension: Types — Severity: P1
- Detail: `JSON.parse(e.data) as WsInboundMessage` trusts wire; only payload inside `wireSessionToRows` validated.

**459. `JSON.parse as WsConfig` no guard**
- File: `src/services/wsConfig.ts:14`
- Dimension: Types — Severity: P2
- Detail: AsyncStorage payload asserted, not validated.

**460. `SubAgentEventWire.detail?: unknown` re-cast per case**
- File: `src/types/wire.ts:77`, `src/services/snapshotReducers.ts:60,108,127,146`
- Dimension: Types — Severity: P2
- Detail: `(event.detail as { task?: string } | undefined) ?? {}`.

**461. `SchedulerEvent` declared but unexported — DONE**
- File: `src/types/wire.ts:101`
- Dimension: Types — Severity: P2
- Detail: Only used inside the inbound union.

**462. RN error event cast**
- File: `src/services/aryaClient.ts:88`
- Dimension: Types — Severity: P2
- Detail: `(err as Event & { message?: string }).message`.

**463. Inline event prop shapes**
- File: `src/components/sessions/SessionRow.tsx:19`, `src/screens/ChatScreen.tsx:77`, `src/components/chat/ChatInputBar.tsx:60`
- Dimension: Types — Severity: P2
- Detail: Reinvents canonical RN types like `GestureResponderEvent`.

**464. `useSafeAreaInsets` leak**
- File: `src/components/chat/ChatInputBar.tsx:292`
- Dimension: Types — Severity: P2
- Detail: `insets?: ReturnType<typeof useSafeAreaInsets>` leaks impl alias into prop API.

**465. Library-driven any in markdown**
- File: `src/components/markdown/MessageMarkdown.tsx:101, 116-122`
- Dimension: Types — Severity: P2
- Detail: `react-native-markdown-display` `node: any`.

**466. Tailwind hand-mirrored from theme**
- File: `tailwind.config.js`, `src/theme/themes.ts`
- Dimension: Types — Severity: P2
- Detail: Both lists ship identical hexes. Renaming theme key won't error.

**467. WS protocol duplicated, drifting**
- File: `src/types/wire.ts` vs `arya/src/ws.ts`
- Dimension: Types — Severity: P1
- Detail: Server is `Record<string, unknown>`; companion strict. Server's `activity` absent from `WsInboundMessage`. Server's `ApprovalRequest.sessionId: string | null` vs client's `string`. Server has no handler for `active_agent`/`set_active_agent`/`sub_agent_event`/`scheduler_event` despite client declaring them.
- Direction: resolved by #409. Once arya's WS is a harness `WsChannel`, both server and companion derive the wire shape from the harness Channel API — drift goes away. See [[feedback-harness-role]].

### Entities

**468. Streaming via sentinel, not entity**
- File: `src/types/domain.ts:89`, `src/hooks/useTranscript.ts:30-42`
- Dimension: Entity — Severity: P1
- Detail: `STREAMING_ROW_ID` synthesized in hook, parallel `streamingPlaceholders: Map<sid,string>`. No first-class `StreamingMessage`.

**469. `ApprovalSnapshot` global pool, not per-session**
- File: `src/state/store.ts:41`
- Dimension: Entity — Severity: P1
- Detail: `Map<approvalId, ApprovalSnapshot>` — no ordering, no per-session filtering, no concept of active prompt vs background pending.

**470. `SubAgentRunSnapshot` flat**
- File: `src/types/domain.ts:73-85`
- Dimension: Entity — Severity: P2
- Detail: No `parentRunId`. Nested sub-agents collapse to siblings.

**471. Wire/domain separation clean**
- File: `src/types/wire.ts`, `src/types/domain.ts`, `src/services/projectMessage.ts`, `src/services/snapshotReducers.ts`
- Dimension: Entity — Severity: (info)
- Detail: Package's strongest entity boundary.

**472. `authorAgentId` wrong attribution**
- File: `src/services/projectMessage.ts:81`
- Dimension: Entity — Severity: P1
- Detail: `activeAgentId` fallback for every assistant row. Historical transcripts attribute to currently-active agent.

**473. PHANTOM: inline approval/sub-agent rows**
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

**477. `ConnectionState` collapsed into boolean**
- File: `src/state/store.ts:25-26`
- Dimension: Entity — Severity: P1
- Detail: `socket + connected: boolean`. No states for connecting/reconnecting/disconnected-with-reason/token-missing.

**478. Missing entities**
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

**487. Tailwind ↔ theme hand-mirrored**
- File: `tailwind.config.js:11-31`, `src/theme/themes.ts:100-123`
- Dimension: Simplification — Severity: P2
- Detail: Both lists ship identical hexes. Pick one source.

**488. ThemeContext collapsible — DONE**
- File: `src/theme/ThemeContext.tsx`
- Dimension: Simplification — Severity: P2
- Detail: Provider holds frozen literal — could be `export const colors = {...}`.

**489. screens/ → app/ indirection**
- File: `src/app/`, `src/screens/`
- Dimension: Simplification — Severity: P2
- Detail: `index.tsx`/`two.tsx`/`sub-agent/[runId].tsx` all do trivial re-exports.

**490. No Tamagui (premise wrong)**
- File: package.json
- Dimension: Simplification — Severity: (info)
- Detail: Only NativeWind. "Second system" is the bespoke `themes.ts`/`ThemeContext` whose colors mirror Tailwind 1:1.

---

## SYNTHESIS — Cross-cutting patterns

**491. Pattern: AbortSignal threaded nowhere**
- Packages: mu-core, mu-tools (bash), mu-webfetch, mu-local-provider, mu-coding-agent (Ctrl-C)
- Detail: Tool.execute(args: string) has no signal slot in mu-core. Every "user can cancel" promise is technically false. The same hole repeats in 5 places because none of them can fix it locally.
- Severity: P1
- Fix: Add `signal: AbortSignal` to `Tool.execute` signature; thread runtime signal through.

**492. Pattern: Stringly-typed tools everywhere**
- Packages: mu-core (Tool.execute), mu-tools, mu-webfetch, mu-harness (Command generics), mu-local-provider tool-call deltas
- Detail: Schema lives in JSON, TS shape in `as` casts. Every tool re-parses, re-casts, returns strings with `"Error: ..."` prefix. Drives the no-signal hole, schema/TS drift, and brittle dispatch.
- Severity: P1
- Fix: `defineTool<TArgs, TResult>(schema, execute)` with runtime validation + `Result<T> | ToolError` return type.

**493. Pattern: Plugin RCE × open WS × LAN bind**
- Packages: mu-harness (plugin-loader), arya/server (auth + bind)
- Detail: Plugin loader runs any `.ts/.js` in data-dir on boot; arya writes `authToken: ''` as default and treats empty as no-auth; binds 0.0.0.0 by default. Combined: LAN attacker writes file in `~/.config/arya/plugins`, gets RCE.
- Severity: P1 (highest in review)
- Fix: Sandbox plugin loader, refuse empty token, bind 127.0.0.1.

**494. Pattern: SSRF + path traversal — sanitizers exist, every endpoint leaks**
- Packages: mu-webfetch (no SSRF), mu-tools (restrictToCwd symlink bypass + bash skips), mu-harness (glob dotAll matches newlines)
- Detail: Permission infrastructure exists (config flag, sanitizer, glob matcher) but each implementation has a subtle defeat.
- Severity: P1
- Fix: Audit pass on all sanitizers; realpath in mu-tools, SSRF allowlist in webfetch, drop dotAll in harness.

**495. Pattern: WS wire protocol drift**
- Packages: arya/server, arya-companion
- Detail: Companion has discriminated `WsInbound`/`WsOutbound` unions hand-mirrored from server which uses `Record<string, unknown>`. Server emits `activity` (companion drops); companion declares `turn_start`/`set_active_agent` (server has no handler); `ApprovalRequest` shape differs.
- Severity: P1
- Fix: Shared `@arya/wire` or `mu-protocol` package with zod schemas.

**496. Pattern: Stale READMEs/planning docs**
- Packages: mu-core (AGENTS.md → defineProvider missing), mu-tui (CONTEXT.md 1158 LOC vs reality 8836), mu-local-provider (README → Ollama+LM Studio), arya (README/PLAN → createAryaToolsPlugin), mu-coding-agent (STATUS_SLOTS plugin extension never used)
- Detail: Design intent moved faster than code.
- Severity: P1
- Fix: Choose — update docs OR ship the missing features.

**497. Pattern: Dead channels/mentions/scheduler in harness while arya reinvents — REFRAMED (wiring gap)**
- Packages: mu-harness (channels, mentions, scheduler, roundtrips — zero in-repo consumers), arya/server (built own WS bridging)
- Detail: Worst-of-both-worlds: ~1000+ LOC of channel/mention/scheduler infra that arya re-implements ad-hoc.
- Severity: P1
- Fix: harness is the intended base. Wire coding-agent and arya through it — `bootstrap()` from coding-agent (#319, #320, #322), `WsChannel` for arya (#409). Do NOT delete the harness infra; that is the design's load-bearing layer. See [[feedback-harness-role]].

**498. Pattern: God-class anti-pattern (6 places, same pathology)**
- Packages: ChatApp.ts 1608, tui.ts 750, runtime.ts 435, bootstrap.ts 300, ws.ts ~300, aryaClient.ts 338
- Detail: Each owns ~6 concerns. Bug density highest in these files.
- Severity: P1
- Fix: Split into smaller composition roots; latent races become visible.

**499. Pattern: Atomic-write missing (4 sites)**
- Packages: mu-harness jsonl-store (touch + persistOnBus), mu-tools (write-file/edit-file), mu-coding-agent state
- Detail: Crash mid-write loses or corrupts data.
- Severity: P1
- Fix: `mu-core` shared helper `os.tmpdir → fsync → rename`. Closes 4 sites with one shape.

**500. Pattern: Approval/Session entities anaemic**
- Packages: mu-harness (ApprovalRequest no sessionId/agentName/channelId), arya/server (singleton activeSessionId), arya-companion (global ApprovalSnapshot pool), mu-core (Session conflates persisted+queues)
- Detail: All four bugs share root: approval/session entities lack context fields for multi-tenant correctness.
- Severity: P1
- Fix: Enrich entities with full context (`sessionId`, `agentName`, `channelId`); separate persisted Session from runtime queues.

**501. Pattern: Duplicated types across boundaries**
- Packages: AgentDisplay × 3 (harness SubAgent, coding-agent main.ts, ChatApp.ts), MouseEvent × 2 (mu-tui), wire.ts × 2 (arya), ChatBus locally re-shaped, Message/ToolCall re-cast between core ↔ local-provider ↔ harness jsonl-store
- Detail: Drift incident already happened with wire.ts.
- Severity: P1
- Fix: Single canonical source; export from one place.

**502. Pattern: SubAgent vs Agent identity confused**
- Packages: mu-harness (SubAgent double duty), mu-coding-agent (AgentDisplay re-projection), arya-companion (AgentInfo.type never set correctly — every assistant attributed to activeAgentId, losing history)
- Detail: Primary-cycling and sub-agent-dispatch features both built on a type that doesn't distinguish the two roles.
- Severity: P1
- Fix: Introduce `AgentDefinition` with explicit role enum; split `PrimaryAgent` vs `SubAgent`.

**503. Pattern: Phantom dead enum members & rendered UI**
- Packages: arya-companion (SubagentStatus='aborted', ApprovalSnapshot.status='timeout', AgentInfo.type='subagent', inline approval/sub-agent rows), mu-coding-agent (ContextMap 259 LOC dead), mu-harness (channels/mentions/scheduler unused), mu-local-provider (LocalBackendKind single-member union)
- Detail: Union/enum announces intent never implemented; downstream code carries cost of handling phantom case.
- Severity: P2
- Fix: Prune dead members; either implement or remove.

---

## Final notes / Caveats

**504. No runtime tests executed**
- Detail: Race findings (start/stop, paste overflow, ghost sockets, scheduler ordering) are static-analysis hypotheses. Some will reproduce; some won't under real timing.

**505. No load/concurrency testing**
- Detail: Session id collision under load and arya multi-client trampling are theoretically real but unmeasured.

**506. No deep security audit**
- Detail: SSRF, plugin RCE, glob-bypass, restrictToCwd symlink were easy from code reading. Real audit would find more (turndown XSS, undici header injection, prompt-injection through tool results, MITM on `ws://`).

**507. No UX testing on mobile**
- Detail: "Approvals never render" was found by code reading. Worth a 10-min manual test before refactoring.

**508. No perf measurements**
- Detail: `useTranscript` rebuilding every render, `subAgentPreviews` map never pruned, `setInterval` idle-poll — flagged but unquantified.

**509. Review framing assumed independent dimensions**
- Detail: Most P1s are systemic (signals, types, atomicity, drift). 12 agents flagging "no AbortSignal" = redundant findings; counted once in synthesis.

**510. Cross-version drift between published and in-repo code uninvestigated**
- Detail: mu-core noted `npm/` vs root version drift (0.15.0 vs 0.16.0). What's on npm right now wasn't checked.

**511. arya/server has zero tests**
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
| 10 | Extract `mu-chat-ui` from coding-agent; split ChatApp.ts into 5-6 component owners | coding-agent + new pkg | L | medium | shrinks 1608-LOC god class |

---

**Total findings: 511 (1-490 from per-package reviews, 491-503 cross-cutting patterns, 504-511 caveats and synthesis notes).**
