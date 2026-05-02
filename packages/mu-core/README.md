# mu-core

The mu plugin SDK. Provides the agent loop, plugin registry, LLM types, and
the multi-host primitives (channels, sessions, activity bus, providers).
Provider implementations are separate packages — for OpenAI-compatible APIs,
add `mu-openai-provider` and register its plugin alongside.

## Install

```bash
npm install mu-core mu-openai-provider
```

## Usage

```ts
import { runAgent, PluginRegistry } from "mu-core";
import type { ChatMessage, ProviderConfig } from "mu-core";
import { createOpenAIProviderPlugin } from "mu-openai-provider";

const config: ProviderConfig = {
  baseUrl: "http://localhost:11434/v1",
  maxTokens: 4096,
  temperature: 0.7,
  streamTimeoutMs: 30000,
  // providerId defaults to 'openai' — register at least one provider
  // implementation (e.g. via createOpenAIProviderPlugin) before running.
};

const registry = new PluginRegistry({ cwd: process.cwd(), config: {} });
await registry.register(createOpenAIProviderPlugin());

const messages: ChatMessage[] = [
  { role: "user", content: "Hello" },
];

const controller = new AbortController();

for await (const event of runAgent(messages, config, "qwen2.5", controller.signal, registry)) {
  if (event.type === "content") process.stdout.write(event.text);
}
```

For a higher-level API that owns conversation state, channel I/O, and
multi-session lifecycle, see `startMu` and `Session` (`createSessionManager`).

## Plugin System

Plugins can provide tools, system prompts, lifecycle hooks, slash commands,
custom agent loops, and side-channel registries (channels, providers,
activity bus, agent sources).

```ts
import type { Plugin } from "mu-core";

const myPlugin: Plugin = {
  name: "my-plugin",
  tools: [
    {
      definition: {
        type: "function",
        function: {
          name: "hello",
          description: "Say hello",
          parameters: { type: "object", properties: {} },
        },
      },
      execute: async () => "Hello, world!",
    },
  ],
  hooks: {
    beforeLlmCall: (messages, config) => messages,
    afterLlmCall: (result) => result,
    beforeToolExec: (toolCall) => toolCall,
    afterToolExec: (toolCall, result) => result,
  },
};

await registry.register(myPlugin);
```

Filesystem and shell tools live in `mu-coding` (`createCodingToolsPlugin`),
not in mu-core — keeps the SDK host-agnostic.

## API

### Agent loop
- `runAgent(messages, config, model, signal, registry)` — async generator yielding `AgentEvent` (`content`, `reasoning`, `messages`, `usage`, `turn_end`).
- Provider resolution: looks up `config.providerId ?? 'openai'` in the registered `ProviderRegistry`. Throws if no provider is registered.

### Sessions
- `createSessionManager({ registry, config, model })` returns a `SessionManager`.
- `session.runTurn({ userMessage, ... })` — appends, drains queue, runs agent loop, emits events.
- `session.subscribe(listener)` — `messages_changed`, `stream_partial`, `stream_started`, `stream_ended`, `usage`, `error`.

### Channels
- `Channel` interface (`id`, `start`, `stop`) — input surfaces (TUI, Telegram, websocket).
- `createChannelRegistry()` — host-managed registry; `startAll()` / `stopAll()` for lifecycle.

### Providers
- `ProviderAdapter` + `createProvider(adapter)` — build a `Provider` from raw HTTP semantics.
- `readSSE`, `readNDJSON`, `fetchWithIdleTimeout` — transport primitives.
- `ProviderRegistry` — host-managed; populated by provider plugins.

### Host
- `startMu(options)` — generic bootstrap: loads config, builds registries, activates plugins (config-listed via `options.resolvePlugin`, then code-passed), starts channels.

## License

MIT
