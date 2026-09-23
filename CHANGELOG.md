# [0.37.0](https://github.com/gaetan-puleo/mu-ai/compare/v0.36.0...v0.37.0) (2026-09-23)


### Features

* **coding-agent:** float the slash-command palette above the input ([6ceb514](https://github.com/gaetan-puleo/mu-ai/commit/6ceb514a47156a90ad7af47ff14cc486e0f0c6dd))

# Changelog

All notable changes to mu packages. Versions are unified across all packages in this repo.

## 0.36.0

### Changed

- **Single product package.** The `mu-harness` package is folded into `mu-coding` under `src/harness/` — agents, commands, config, permissions, plugins, scheduler, sessions, skills, sub-agents and the chat TUI now live in one installable package. The standalone `mu-harness` package is removed.

### Added

- **Generic, host-driven side panel.** The chat TUI sidebar is now a generic `PanelSection`/`PanelItem` model rendered from host-supplied sections (`ChatHost.subscribePanel`), so a remote host can drive the sidebar declaratively.
- **Start screen.** A fresh session shows the logo (or host banner) above a centered, width-limited input with the status bar pinned at the bottom.
- **Gradient banner + `mu` mark.** The banner renders with a vertical color gradient; a Braille `mu` mark is available for the in-process logo.
- **Context in the status bar.** Token usage (`used/total (pct%)`) now shows on the right of the status bar even in minimal mode.
- **Generic `openai` backend in `mu-local-provider`.** Any OpenAI-compatible endpoint (e.g. halogen) is now detected as a last fallback after llama-swap/llama-cpp: recognized via a non-empty `/v1/models` list, streamed through the OpenAI SDK, context window read from `/health.context` when present. Modalities and exact tokenization are unavailable (reported as `undefined`).

## 0.33.0

### Added

- **Voice input in the chat TUI.** `/voice` (push-to-talk: record a clip, transcribe it into the composer) and `/call` (hands-free realtime dictation that re-transcribes as you speak). Speech-to-text runs through a new `harness.voice` transcriber (`createVoice`) against an audio-capable model — configured via `voiceModel`, falling back to the selected chat model when it accepts audio (otherwise `/voice` reports it's unavailable rather than recording). Over a WS channel it is exposed as `voice:check` / `voice:transcribe` frames; in-process it calls the provider directly. Recorders are auto-detected (ffmpeg / arecord / parecord / pw-record).
- **`Provider.stream` accepts `chatTemplateKwargs`** — per-turn extra `chat_template_kwargs` (e.g. `{ enable_thinking: false }` to disable a Qwen3 reasoning template). The local provider applies its provider-level `chatTemplateKwargs` default to the main model only and **merges** the per-turn value on top (per-turn keys win on collision).
- **Session logs round-trip binary attachments.** Image/audio `Uint8Array` data is tagged + base64-encoded on write and rebuilt on read, so reloading/resuming a session that contains attachments no longer corrupts the bytes.
- **`coding-agent` honours `primaryAgents` from `config.json`** (previously declared but never loaded) and ships a built-in read-only `reviewer` agent.

### Fixed

- **bash-safety: file-writing flags no longer slip through as read-only.** `sort -oFILE` (value glued to the short flag) and `find … -fprint0 FILE` were classified read-only and auto-approved; both are now treated as writes (so they prompt for approval).
- **`/call` could double-transcribe.** A second Enter while the final transcription was in flight re-entered the finisher and ran a duplicate pass (doubling model load and inserting the text twice). Call state is now cleared synchronously, and the realtime dictation's `finish()` is idempotent.
- **A failed call recorder no longer crashes the TUI.** The streaming recorder attaches an `error` listener — an unhandled spawn-failure `error` event previously tore down the whole process — and surfaces the failure as a normal "could not start recording" message.
- **`/voice` and `/call` are gated on a running turn**, so starting dictation mid-response no longer desyncs the status spinner.
- **Recorder start is race-safe.** A synchronous sentinel stops a rapid double toggle from spawning two recorders (which leaked a mic process + temp dir), and a teardown during startup cancels the just-spawned recorder.
- **Voice requests over WS no longer hang on disconnect.** `transcribe()` / `unavailableReason()` are settled when the socket drops or a send is dropped (the WS client now reports send failure and a `close` event) instead of leaving the promise pending forever.
- **Atomic session-log rewrite.** Compaction's in-place history rewrite now writes a temp file and renames it over the target, so a crash mid-write can't truncate or corrupt the whole session.

## 0.17.0 – 0.32.0

Not individually documented here — see the git history and GitHub release notes. Highlights across these versions: the universal `/context` view (Claude Code-style grid), `AGENTS.md`/`CLAUDE.md` instruction scopes, the memory system + `remember` tool, auto-compaction + `/compact`, and first-run channel setup with QR connect.

## 0.16.0

### Breaking

- **`RuntimeConfig.provider` removed** (`mu-core`). Providers must now be supplied via a plugin entry: `plugins: [{ name, provider }]`. Hosts that previously passed `createRuntime({ provider, ... })` must wrap the provider in a plugin.
- **`AgentRuntimeConfig.provider` removed** (`coding-agent`). Same propagation — wrap the provider in a plugin and pass via `plugins`.

### Fixed

- **Failed turns no longer wipe queued user messages.** The cross-turn `consecutiveErrors` counter and `MAX_CONSECUTIVE_ERRORS` constant are gone. A failed turn now just publishes an `error` event and the runtime moves on to the next queued message.
- **Single combined assistant transcript entry for `content + tool_calls` turns.** Previously the runtime pushed two consecutive `assistant` messages (one with content, one with empty content + `tool_calls`). Now a single `{ role: 'assistant', content, tool_calls }` entry is written.
- **`assistant_start` now fires for non-streaming providers** (previously stream-only).
- **`tool_call` bus events fire for calls declared in `done.response.tool_calls`** even when a provider doesn't emit them as separate stream events. De-duplicated by `id` so providers that emit both don't double-publish.
- **`steer` / `follow_up` arriving while the runtime is idle now emits `queue_update` and `queued_message` events** before starting the turn (previously bypassed silently).

### Changed

- **Event order for non-streaming providers returning content + tool_calls.** Previously: `assistant_message → tool_call`. Now: `tool_call → assistant_message`. This aligns with the streaming path and is the recommended ordering for hosts that render tool calls as part of an assistant turn.
- **`resolveProvider` requires exactly one plugin-provided provider.** Zero providers or more than one throws a clear error.
- **`coding-agent` bin guards against double-provider configuration.** If any loaded plugin already exposes `.provider`, the synthetic local-provider plugin is not appended.
- **Synthetic local-provider plugin renamed** from `'mu-local-provider'` to `'__local-provider'` to avoid name collision with the published npm package.

### Internal

- Stream and non-stream provider results now flow through a single code path in `processStream`; the standalone non-stream branch was removed.
- `AGENTS.md` updated to reflect the actual `CoreEvent` shape and the plugin-only provider contract.
