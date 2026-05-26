# Changelog

All notable changes to mu packages. Versions are unified across all packages in this repo.

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
