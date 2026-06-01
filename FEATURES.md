# Feature inventory: `coding-agent` + `arya`

Both products are thin apps over a shared **`mu`** monorepo. Same engine, two front-ends:

- **`coding-agent`** ("mu") — a **terminal** chat app (custom TUI), local-first.
- **`arya`** — a **WebSocket server** (`packages/arya`) + an **Expo/React Native mobile companion** (`packages/arya-companion`), in the sibling repo `~/dev/arya-agent`.

Grouped by the shared foundation first, then each product's own features. Status flags note anything `partial` / `planned`.

---

## Part 1 — Shared foundation (`mu` packages)

### `mu-core` — the agent runtime engine
- **Streaming agent roundtrip loop** — pops a queued message, calls the provider, runs tool calls in parallel, appends results, re-loops until the model stops calling tools. Fresh `AbortController` per turn.
- **Three message queues with distinct semantics** — `main` (user messages), `steering` (drains *mid-turn*, interleaves into a running response), `follow-up` (drains only after the model otherwise finishes).
- **Dual provider shapes** — handles both one-shot `LLMResponse` and streaming `AsyncIterable` (delta / reasoning_delta / tool_call / done events), with tool-call dedupe.
- **Parallel tool execution** with per-call `callTool` pipeline: `beforeTool` veto hook → JSON arg parse → execute → `onError` fallback → result normalization → `afterTool` rewrite hook.
- **Loop-detection guard** — kills the turn if an identical `name:args` tool call repeats > 5 times (configurable).
- **Empty-response guard** — bails instead of spinning if a roundtrip produces no tool calls and no transcript growth.
- **State machine** — idle / running / stopped; a stopped runtime can't restart.
- **Lifecycle hooks** — plugin `onStart` (in order) / `onStop` (reverse order) / `onError`, isolated so a throwing hook can't crash the runtime.
- **Typed EventBus** (~14 `CoreEvent`s) — `assistant_start/delta/message`, `reasoning_delta/message`, `tool_call`, `tool_result`, `queued_message`, `queue_update`, `context_update`, `state_change`, `error`, plus inbound `user_message/steer/follow_up`. Synchronous pub/sub with listener isolation.
- **Provider abstraction** — injected `LLMProvider`; exactly one plugin must supply it (errors on zero/multiple).
- **Plugin contract** — `{name, tools?, hooks?, provider?}` with name-collision-checked tool merging.
- **Tool model** — `defineTool`/`defineTools`, JSON-schema params, resolvable descriptions/system prompts, raw-JSON-string args parsed at call time.
- **Dynamic tool filtering** (`toolFilter`) re-applied every turn → permission/mode-driven tool gating.
- **Resolvable per-turn system prompt** (value or async thunk; never persisted to the transcript).
- **Message/content model** — System/User/Assistant(+tool_calls,reasoning)/Tool union, optional id+timestamp, open `MessageSource` union (`user|cron|rpc|agent|…`) threaded through events, hooks, and `ToolContext`.
- **Usage/context model** — `ContextMap` breaking the window into typed parts (system/tools/messages/tool_results/skills/mcp/other) with token counts + `estimated` flags.
- **In-memory SessionStore** — list/get/create/fork/delete/touch + change subscription; deep-clones initial messages; injectable id/clock.
- **Session forking with validation** — copies messages `0..atIndex`, records `forkedFrom` provenance; rejects out-of-range index or a non-user pivot message.

### `mu-harness` — orchestration layer
- **`bootstrap()`** — assembles a full agent host from XDG dirs: loads plugins, sub-agents, skills; picks the primary agent; builds tools (incl. subagent dispatch tools); builds the permission model + approval queue; resolves the session store; produces a dynamic system prompt + before-tool hook.
- **Dynamic primary-agent switching** — system prompt, permission registry, and tool filter all re-evaluate per call against the currently active primary.
- **Three-state permission model** (allow / deny / ask) with **precedence deny > ask > allow**, glob-based tool/args matching (`*`→`.*`, `?`→`.`, anchored regex), and a default decision.
- **Permissions files** (JSON or YAML) — multi-file merge with validation, descriptive errors with file path + rule index.
- **Asynchronous approval queue** — `request()` returns a promise resolved when a UI decision arrives; `pending()`/`subscribe()`; per-request UUID + agent/session/channel metadata.
- **Before-tool permission hook** — allow→proceed, deny→`Blocked` reason, ask→await the prompt (or block if no handler).
- **Session store resolution** — JSONL on disk (default), in-memory, or injected.
- **Agent runtime adapter** (`createAgentRuntime`) — model selection, `listModels`, `onModelChange`, multi-session create/resume (`Unknown session` error on miss).
- **RoundtripStore** — normalizes each response's usage/context into observable roundtrips (used/window/completion tokens, parts, estimated flag), with subscription.
- **Plugin loader** — manifest discovery (`plugin.manifest.json`/`mu.plugin.json`) in dir + subdirs; entrypoint **sandboxing** (rejects absolute paths, path-traversal escapes, bad extensions); loose files skipped.
- **Trust-on-first-use (TOFU)** — SHA-256 hashes entrypoints, records on first load, **refuses on hash change**, **fails closed** if the trust file is corrupt; atomic flush.
- **npm plugin loading** — validates `npm:`/`@scope` spec regexes before dynamic import; default-export validation.
- **Plugin install/uninstall** — `deno cache` / `npm install`, local-file copy, registry persistence, trust warning to stderr.
- **Provider plugin selection** with named lookup + fallback plugin.
- **XDG path layout** (3 roots) — config (`config.json`, `.env`, `permissions.json`, `agents/`, `skills/`, `tasks/`, `plugins-trust.json`), data (`plugins/`, `sessions/`), state (`state.json`, `history.json`).
- **Input history store** (de-dupes consecutive, trims to max 500) and **generic validated JSON store**.

#### Harness feature modules
- **Slash-command registry** — `/name args` parse + dispatch, insertion-ordered, `deferWhenBusy` flag, structured `CommandResult`. Built-ins: **`/agents`**, **`/sessions`**, **`/help`**.
- **Deferred command queue** — buffers commands while the agent is busy, drains on idle, error-isolated.
- **@-mention expansion engine** — `@prefix:target` via pluggable resolvers, **skips code regions**, honors **backslash escapes**, parallel resolution, right-to-left replacement.
- **Skills** — markdown + YAML frontmatter; loaded from dirs (later dirs override); advertised in the system prompt as `<available_skills>`; full body injected on invocation.
- **Sub-agents** — markdown definitions with **per-tool permission maps** (`allow`/`deny`/`ask`, including `{glob: decision}`); loaded/deduped from dirs.
  - **Isolated runner** — fresh mu-core runtime, tool/plugin filtering to the allow-list, default-`allow` permission registry, idle-poll with **10-min timeout** + abort support, error aggregation.
  - **Dispatcher** + two model-callable tools: **`subagent`** (one) and **`subagent_parallel`** (concurrent runs joined with separators); parent-reply formatting that tells the parent to treat output as research.
  - **Primary-agent selection/state** — active + transient override; **agent routing** via leading `@mention` (primary→override, sub-agent→dispatch).
- **Channels** — multi-transport multiplexer (id→Channel map, input fan-out, broadcast); typed in/out event protocol; open `ChannelKind` union (`tui|ws|telegram|slack|rpc|…`). Concrete **readline TUI channel** with full event rendering + color/no-color.
- **Croner scheduler plugin** — loads YAML tasks (`{id,cron,prompt,timezone?,channel?}`, single or array) from `tasks/`, publishes `user_message` with `source:'cron'` on fire, tracks running→idle to emit `task_started/completed(duration)/failed`.
- **Session persistence** — JSONL transcript + `.meta.json` sidecar; create/fork/delete/**rename**/touch; `summaries()` sorted by recency; bus-following persistence that follows session switches; **resuming-store** wrapper that re-attaches to a prior session on first create.
- **TUI helpers** — `statusFromEvent` (event→status string), braille spinner, `formatTokens`, status-part builders, transcript model.

### `mu-tools` — filesystem + shell
- **`read`** — single path *or array of paths*; 1-indexed inclusive line ranges; streamed 64 KB chunked reader (no full-file load); numbered gutter + header; binary-file refusal; not-found handling.
- **`write`** — atomic write (temp-file + rename, auto-creates dirs); refuses to overwrite an existing *binary* file.
- **`edit`** — exact-substring replace; errors if `from` is absent or non-unique; atomic write.
- **`bash`** — `bash -c` **detached in its own process group**, 120 s timeout, configurable output cap (10 MB) with truncation marker + auto-abort, **SIGTERM→SIGKILL escalation** to the whole group, abort via `ctx.signal` or fallback.
- **`list_dir`** — tree with connectors + emoji icons (📁/📄/🔗/⚠), recursive with depth cap, symlinks not followed, per-dir `[permission denied]` instead of throwing.
- **Shared safety** — path sanitization (quote-stripping, cwd-resolution — note: does *not* enforce containment), memoized cwd validation, NUL-byte binary detection.

### `mu-local-provider` — llama-swap backend
- Streaming `LLMProvider` over an OpenAI-compatible endpoint; **lazy backend detection** (confirms llama-swap via `owned_by==='llama-swap'`) + retry; model listing.
- Message/tool ↔ OpenAI conversion; **incremental tool-call assembly** keyed by delta index with eager + fallback emission.
- **Reasoning-content passthrough** (`reasoning_content`/`reasoning`/`reasoningContent` → `reasoning_delta`).
- **Idle-timeout** (default 30 s, re-armed per chunk) + **host-abort** bridging.
- **llama.cpp slot routing + prompt caching** — queries `/slots`, pins a free slot via `id_slot` + `cache_prompt:true`.
- **Context introspection** — `/props` (n_ctx, slots, model path/alias) + `/slots`; **real tokenization** via `/tokenize` (else `len/4` estimate); per-bucket context map; usage reporting.
- Base-URL normalization; `LocalProviderError` taxonomy (`backend_unreachable`/`unsupported`/`config_invalid`).

### `mu-webfetch` — URL → markdown/text/image
- `webfetch` tool/plugin; HTTP(S) only; configurable timeout (0.1–120 s).
- **SSRF protection** — blocks localhost + private/CGNAT/link-local/ULA IPv4 & IPv6 ranges, **DNS-resolves all addresses** (anti-rebinding), fails closed, re-checks on every redirect.
- **Manual redirect following** (cap 5) with per-hop re-validation.
- **Cloudflare challenge retry** (realistic UA first, then `mu` UA on `cf-mitigated: challenge`).
- **5 MB response cap** (early via Content-Length, then streaming abort).
- Charset detection (header + `<meta>` sniff); **HTML→Markdown via Turndown**; **images as base64 data URLs**; markdown-preferring `Accept` header; timeout/abort handling.

### `mu-tui` — from-scratch terminal UI framework
- **Root controller** (`TUI`) — component tree, focus, global keybindings, input interceptors, typed user-context, background color, start/stop lifecycle.
- **Renderer** — cell-buffer frame build + **line-diff output** (rewrites only changed rows via DECSC/DECRC), full repaint on resize, **frame throttling ~60 fps**, force-repaint reset.
- **Synchronized output guard** (DEC 2026) for tear-free frames.
- **Overflow assertion** — throws if any rendered line exceeds terminal width.
- **Flex layout engine** — row/column, `fr`/`fill`/`%`/`auto`/fixed, two-pass distribution, min/max clamps, margins.
- **Positioning** — relative/absolute/overlay + **z-index** painting order.
- **Box model** — margin/padding/border insets; geometry primitives.
- **Overflow clipping** — visible/hidden/scroll with `prepareLayout` viewport recording.
- **CellBuffer compositor** — source-over **alpha blending**, opacity stack, wide-grapheme handling, background tinting, border drawing.
- **Color model** — truecolor / 256-palette / ANSI-16 / named / hex / alpha, tightest-SGR emission.
- **ANSI parsing↔emission** into styled cells (SGR + OSC-8), SGR-delta minimization.
- **Text utils** — East-Asian + emoji-aware width, wrap, truncate-with-ellipsis, column slicing, ANSI strip/tokenize.
- **Input parser** — byte stream → tokens, **bracketed paste** (1 MB cap), incomplete-sequence buffering.
- **Key/mouse decoding** — legacy, xterm modifyOtherKeys, **CSI-u / Kitty keyboard**, **SGR mouse** (press/drag/move/wheel + modifiers), focus in/out, F-keys.
- **Input routing** — interceptors → hit-test → global keybindings → focused component; 25 ms escape-timeout flush.
- **Mouse hit-testing** (topmost by z-index/depth/order) and **focus management** with directional navigation.
- **Terminal capabilities detection** — multiplexer (tmux/screen/zellij), transport (ssh/conpty/tty/pipe), program (kitty/iTerm2/…), truecolor/256, modern-terminal gating, each with a source tag; merge overrides.
- **ProcessTerminal** — raw mode, signal handlers, **DEC private-mode management** (alt screen, bracketed paste, focus events, Kitty keyboard, SGR mouse), stdin-drain on shutdown.
- **Components** — Box, Text, **Input** (single/multi-line editor: blinking cursor, h/v scroll, `hiddenPrefix`, inline highlight ranges, Shift+Enter newline), **ScrollView** (stick-to-bottom), **SelectList** (keyboard+mouse, disabled items, viewport), **Modal** (centered overlay, z-index 1000).
- **OSC-8 hyperlinks**, `KeyChord` matching model.
- `partial`: **SecurityPolicy** capability gating is defined (hyperlinks/clipboard/images/shell + payload cap) but enforcement is left to consumers.

---

## Part 2 — `coding-agent` (terminal app)

**CLI & lifecycle**
- `install` / `uninstall` plugin subcommands; otherwise launches interactive chat; top-level error → exit 1.
- **`-c` / `--continue`** resumes the newest session (warns + starts fresh if none).
- Config loading (`kind`, `baseUrl`, `plugins[]`, `provider`); errors if `baseUrl` missing.
- **Persistent app state** — last `model`, `thinkingVisible`, `activeAgent`; saved on change.
- **Input-history persistence** across runs.
- **Project-local extension dirs** under `<cwd>/.mu/` — `skills/`, `agents/`, `permissions.json`.
- **Provider selection** — local llama-swap by default, or a named provider plugin.
- Signal handling (SIGINT→130, SIGTERM→143), idempotent graceful stop.

**Chat UX (TUI)**
- Alt-screen layout: scrolling transcript (ScrollView) + bottom dock (toast / palette-or-picker / input+model-label / waiting-list / status line) with dynamic heights.
- **Message submit** with `❯`-prefixed user bubbles; **steering** (mid-response submit → live "steering" queued line) and **follow-up** (Alt+Enter → "follow-up" queued line).
- **Waiting-list widget** — shows queued `[cmd]`/`[steering]`/`[follow-up]` items (capped 6).
- **Multi-line input auto-sizing** (1–7 lines) + persisted up/down history navigation with draft preservation.

**Commands & shell**
- **Slash-command palette** — opens on `/`, prefix-filtered, Tab-completes, Enter runs, mouse hover/click.
- **Built-in commands**: `/new`, `/model`, `/context-export [path]`, `/thinking`, `/expand`, `/quit`.
- **Deferred commands while busy** — drain on idle, shown in waiting list.
- **Bash/shell mode** (`!` or `$`) — its *own* `bash -c` child (separate from the agent tool), streaming `OutputBlock`.
- **Collapsible output blocks** (truncate past 8 lines, `ctrl+o` / `/expand` to toggle).
- **`/context-export`** — dumps RoundtripStore to `.mu/context.json` (`{exportedAt, model, roundtrips}`).
- **Model picker modal** — lists models (id + provider), blocked while running.

**Agents & mentions**
- **@-mention file & agent picker** — fuzzy-ranked (subsequence match with boundary bonuses), cached ignore-aware project tree (depth 6, 5000 entries, ~15 ignored dirs), merges agents + files; Tab/Enter inserts.
- **@-mention input highlighting** (bold warning color).
- **Agent routing** — `@primary` overrides the active persona for the next turn; `@subagent` dispatches a task.
- **Primary-agent cycling** — Tab / Shift+Tab when ≥2 primaries.
- **Sub-agent dispatch + live preview cards** (◐/✓/✗ status, colored `@name`, activity line; result fed back to the primary).
- **Sub-agent detail drill-in** — click a card to replace the transcript with its full run timeline; Esc returns.

**Rendering & theming**
- **Hand-rolled Markdown renderer** — headings, blockquotes, lists, inline code, bold, fenced code blocks with language label, **GitHub-style tables**, hard-wrapping.
- **Reasoning/thinking blocks** — italic muted; collapsible `[thinking]` lines; global toggle persisted.
- **Tool-call rendering** — `→ name argsPreview` with smart per-tool arg formatting (path/cmd), 120-char truncation.
- **Status line** — animated braille spinner when busy + context usage `used/total (pct%)`.
- **Cancel generation** (double-Esc within 1.5 s → stop+recreate runtime) and **new session** (`/new`).
- **Error toasts** (red `!`, auto-clear 6 s).
- **Theme system** — dark + **light** themes, **Ctrl+T** toggle, semantic style tokens, ANSI SGR emitter, ThemeProvider pub/sub.
- **Ctrl+C** — clears input if non-empty, else exits (130).

---

## Part 3 — `arya` (server + mobile companion)

### `arya` server (`packages/arya`) — WebSocket-served agent on `mu-harness`
- **CLI subcommands** — default (start runtime), **`init`** (scaffold XDG config + `agents/arya.md`, never overwrites), **`install`/`i`** (npm or local-file plugin).
- **Config discovery** — `$XDG_CONFIG_HOME/arya/config.json` then repo-root fallback; required-field validation (`baseUrl`, `model`, `wsPort`); optionals (`wsHost`, `authToken`, `apiKey`, `kind`, `agentsDir`, `tasksDir`).
- **Port validation** (1–65535).
- **LAN/loopback safety gate** — refuses to start on a non-loopback host with an empty `authToken`; warns on loopback+empty.
- **WS auth handshake** — `?token=` query param (close **4001** on mismatch); `?sessionId=` default-session param.
- **Inbound protocol parser** — `chat`, `command`, `commands`, `agents`, `approval_response`, `set_active_agent`, `sessions:list/create/delete/rename/get`, with descriptive errors and action coercion.
- **Outbound frame set** — `commands`, `agents`, `active_agent`, `stream`, `reasoning`, `message`, `activity` (tool_start/end), `turn_end`, `sessions:listed/changed/history`, `session_deleted`, `approval_request`, `scheduler_event`, `error`.
- **CoreEvent → wire mapping** (deltas, reasoning, messages, tool activity with truncation).
- **WsChannel** — harness `Channel` bridging the agent bus to wire frames for the active session.
- **Harness composition** — local provider + mu-tools + mu-webfetch + scheduler, `permissionSource: 'primary-agent'`, JSONL sessions.
- **Scheduler integration** — cron tasks from `definitions/tasks/` (currently empty); events forwarded as `scheduler_event` broadcasts.
- **Single active runtime multiplexer** — `activate(sessionId)` pins one runtime; `turn_end` via state-change watcher.
- **Tool-approval queue with per-session ownership** — approvals pinned to issuing session; **rejects cross-session approvals**; **replays pending approvals on connect**.
- **Session RPCs** (list/create/delete/rename/get) + `store.watch` change broadcasts.
- **On-connect bootstrap frames** (commands + agents + sessions + pending approvals).
- **Server lifecycle** — `maxPayload` frame cap (1 MiB), oversized-frame socket destroy, broadcast/send, graceful shutdown (close **1008**, await port release).
- **Per-socket session bookkeeping**, inbound error handling (`Invalid JSON`, crash isolation), signal-driven shutdown, **`ARYA_LOG_LEVEL`** logger.
- **Bundled agents** — `arya.md` (primary, simpler perms) and `assistant.md` (hardened: `.env` deny, `git *` allow, writes ask); init writes a granular-permission `arya.md`.
- `partial`: **`set_active_agent`** is an echo-only stub — per-session primary swap is not yet supported (primary is chosen at bootstrap).

### `arya-companion` — Expo / React Native client

**Connection / state / services**
- **Reconnecting WS transport** — http→ws rewrite, token query param, **exponential backoff with full jitter** (500 ms→30 s cap), attempt reset on open.
- **WS lifecycle orchestration** — idempotent start/stop with concurrency guard, stale-socket guards, defensive registry re-request on reconnect.
- **Outbound plumbing** — live-handle ref, `send`/`sendRaw`, typed read-only requests.
- **Inbound dispatch switch** — exhaustive (`never`-checked) wire→store routing.
- **Wire→domain validation** — multi-stage gate dropping transient/LLM-only/tool/empty rows, system→assistant coercion, author attribution that keeps historical rows unattributed.
- **Snapshot reducers** — fold sub-agent lifecycle events + approval requests into render-ready snapshots.
- **Optimistic updates with rollback** — chat (optimistic row + streaming placeholder), command echo, **active-agent selection** (server-authoritative confirm / error rollback); collision-free optimistic id generation.
- **Approvals with single-use replay guard** (`seenApprovalIds`), pending-state re-check, haptics.
- **Session CRUD + persistence** — create/delete/rename/select, current session id persisted to AsyncStorage, delete-all.
- **Zustand store** (connection / registry / sessions / snapshots slices) with immutable Map replacement.
- **Wire + domain type model** with runtime inbound guard; **WsConfig persistence** (validated, never trusts storage).
- **Hooks** — connection mount, transcript (streaming placeholder merge), composer, agents, sub-agent runs, keyboard tracking.
- **Offline behavior** — fail-and-rollback, **no offline queue** (composed-while-offline messages aren't replayed).

**UI / screens / components**
- **Expo Router stack** — 3 routes (chat / settings / `sub-agent/[runId]`); font loading + splash; Android edge-to-edge nav bar; WS mount at root.
- **Chat transcript** (FlashList) — chat bubbles, inline **approval cards**, inline **sub-agent cards**, **typing-dots** streaming placeholder; message grouping, **streaming autoscroll** with pin-to-bottom, **scroll-to-bottom FAB**, empty state.
- **Chat message bubbles** — user vs assistant layouts, **copy** (clipboard) + native **Share**, entrance animations, markdown rendering.
- **Chat input bar** — auto-grow multiline, send button states, keyboard avoidance, inline **slash (`/`)** + **agent (`@`)** menus, **full-screen expand mode**.
- **Inline approval card** — tool-permission prompt with expandable args, Allow/Deny buttons.
- **Inline sub-agent card** — status icon, tool count, elapsed duration, "Details →" to the timeline.
- **Floating agent-switcher chip** — colored dot, dropdown when >1 primary, active checkmark.
- **Sessions drawer** — gesture-driven sliding panel (Reanimated, parallax, velocity/ratio commit, haptics), date-bucketed **session list**, **session rows** (relative time + msg count), **anchored long-press popover** (rename/delete), header (settings shortcut + bulk delete), **New Chat FAB**.
- **Sub-agent detail screen** — header status + FlashList **timeline** (invocation / tool / assistant rows with code boxes + timestamps).
- **Markdown rendering** — themed stylesheet + **streaming-fence repair** (closes odd ``` counts); **syntax-highlighted code blocks** (atomOneDark, language-alias map, copy, horizontal scroll).
- **Settings screen** — WS URL + optional token, Configured/Not-configured pill, dirty-tracking save → reconnect, reset confirm, "How to connect" help steps.
- **Reusable shells** — CenteredCard, ConfirmModal (destructive variant), PromptModal; form primitives (FormGroup, TextField with focus ring, HelpStep).
- **Primitives** — luminance-aware AryaAvatar (WCAG contrast), FloatingPill, drawer-toggle pill.
- `planned`: **`@`-agent menu** is plumbed end-to-end but yields an empty list (server only emits primary-type agents).
- `planned`: **Dynamic/multi-theme** — `useTheme()` is a seam but currently always returns the dark theme.
- `partial`: **Localization** — only the chat empty state is French; the rest is English. No i18n framework.

---

## Repo tooling
- Deno workspace tasks: `dev`, `dev:tui-debug` (`MU_TUI_DEBUG_LOG`), `start`, `check`, `test`, `lint`, `fmt`/`fmt:check`, **`build:npm`**, `publish`, **`compile`** (single `mu` binary).
- Import map pins `@std/*`, `croner`, `ws`, `openai`, `turndown`. fmt: 120-col / 2-space / single-quote / semicolons.

## Notable "not-yet" items (summary)
- `arya` `set_active_agent` is echo-only — no per-session primary swap yet.
- Companion `@`-agent menu is inert until the server emits sub-agent entries.
- Companion theming is dark-only (planned dynamic theming); localization is partial.
- `mu-tui` `SecurityPolicy` is defined but enforcement is left to consumers.
- The arya scheduler is fully wired but `definitions/tasks/` ships empty.
