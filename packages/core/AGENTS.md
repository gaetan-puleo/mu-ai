# mu-core Terms

This package (`packages/core/`) contains only the primitives required to build agent runtimes and provider plugins.
It must not contain provider-specific implementations such as OpenAI, Ollama, LM Studio, llama-swap, HTTP clients, SDK clients, API keys, or model server defaults.

## Core

`mu-core` is the provider-agnostic runtime package.

It owns:

- Runtime primitives
- Message types
- Tool types
- Provider interfaces
- Event bus primitives
- Hook primitives

It does not own:

- OpenAI SDK code
- HTTP request code for model APIs
- Local model server defaults
- Provider-specific message conversion
- Provider-specific tool conversion

## Provider

A provider is an adapter between `mu-core` and an LLM backend.

A provider receives the current transcript and available tools, then returns a normalized `LLMResponse`.

```ts
type LLMProvider = (
  messages: Message[],
  tools: Tools,
) => Promise<LLMResponse>;
```

Providers live outside `mu-core` and are passed to the runtime exclusively through a `Plugin`. `RuntimeConfig` has no top-level `provider` field — the host must wrap the provider in a plugin (`{ name, provider }`). Exactly one plugin in `plugins` may carry a `provider`; zero or more than one is an error.

Examples:

- `mu-local-provider`
- Future OpenAI provider
- Future Anthropic provider
- Future llama-swap provider

## Provider Factory

A provider factory creates an `LLMProvider` from provider-specific config.

```ts
type ProviderFactory<Config> = (config: Config) => LLMProvider;
```

`mu-core` may provide `defineProvider()` as a typing primitive, but the implementation belongs to provider packages.

## Runtime

A runtime is the long-lived reactive process that connects:

- User messages
- Provider calls
- Tool calls
- Tool results
- Assistant messages
- Errors

The runtime reacts to events from the event bus.

The runtime replaces the old generator-style `run()` API.

## Event Bus

The event bus is the pub/sub primitive used by the runtime and host UI.

It allows the host to publish user input and subscribe to runtime output.

```ts
bus.publish({ type: 'user_message', message });
bus.subscribe((event) => {});
```

The bus is synchronous and minimal by default.

## Core Event

A core event is a normalized runtime event.

Inputs the host can publish to the bus:

```ts
type CoreEvent =
  | { type: 'user_message'; message: Message }
  | { type: 'steer'; message: Message }
  | { type: 'follow_up'; message: Message }
```

Outputs the runtime emits on the bus:

```ts
  | { type: 'queued_message'; queue: 'steering' | 'follow_up'; message: Message }
  | { type: 'queue_update'; steering: Message[]; followUp: Message[] }
  | { type: 'assistant_start' }
  | { type: 'assistant_delta'; content: string }
  | { type: 'assistant_message'; message: Message }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'reasoning_message'; message: Message }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; message: Message }
  | { type: 'context_update'; context: LLMResponseContext }
  | { type: 'error'; error: unknown };
```

Notes:

- `assistant_start` fires once per assistant turn, before any deltas or tool calls.
- `assistant_message` fires only when the turn produced user-facing content. A turn with only `tool_calls` does not emit `assistant_message`.
- For a turn that produces both content and tool calls, the order is `tool_call` events → `assistant_message`.
- `tool_call` events are de-duplicated by `id`: a call declared in both a `tool_call` stream event and `done.response.tool_calls` is published once.

## Message

A message is an entry in the transcript.

```ts
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'reasoning';
  content: string;
  tool_id?: string;
  tool_calls?: ToolCall[];
};
```

- `tool_id` is set on `role: 'tool'` messages and references the originating `ToolCall.id`.
- `tool_calls` is set on `role: 'assistant'` messages that requested tool execution. A single assistant message may carry both `content` and `tool_calls`.
- `role: 'system'` is constructed by the runtime when building the per-call provider input from `systemPrompt` + per-tool prompts. It is never pushed to the transcript.

Provider packages are responsible for converting these messages into backend-specific formats.

## Transcript

The transcript is the ordered list of messages known by the runtime.

The runtime owns the transcript during execution.

Providers receive the transcript as input but must not mutate it.

## Tool

A tool is a callable capability exposed to the provider.

```ts
type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: string) => string | Promise<string>;
  onError: (error: unknown) => string;
};
```

## Tool Call

A tool call is a normalized request from the provider to execute a tool.

```ts
type ToolCall = {
  type: 'tool_call';
  id: string;
  tool: string;
  args: string;
};
```

Provider packages convert backend-specific tool call formats into this shape.

## LLM Response

An LLM response is the normalized provider output consumed by the runtime.

```ts
type LLMResponse = {
  content?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
};
```

## Hooks

Hooks are runtime extension points around tool execution.

They are provider-agnostic and stay in `mu-core`.

Examples:

- `beforeTool`
- `afterTool`

## Host

The host is the application using `mu-core`.

Examples:

- `mu-coding`
- TUI
- CLI
- tests

The host wires together:

- bus
- runtime
- provider
- tools
- plugins

## Local Provider

`mu-local-provider` is the provider package for OpenAI-compatible local model servers.

It owns:

- OpenAI SDK dependency
- Ollama defaults
- LM Studio defaults
- llama-swap defaults
- conversion between `mu-core` primitives and OpenAI-compatible API payloads

To wire it into the runtime, the host wraps `createLocalProvider(...)` in a `Plugin` entry and passes it via `plugins`:

```ts
createRuntime({
  bus,
  plugins: [{ name: 'mu-local-provider', provider: createLocalProvider(config) }],
});
```

## Forbidden In mu-core

Do not add these to `mu-core`:

- `openai`
- `fetch()` calls to model APIs
- `/v1/chat/completions`
- `baseUrl`
- `apiKey`
- Ollama-specific code
- LM Studio-specific code
- llama-swap-specific code
- provider-specific response parsing
