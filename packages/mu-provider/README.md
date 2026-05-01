# mu-provider

LLM provider abstraction for OpenAI-compatible APIs. Streams chat completions with support for reasoning, tool calls, and image attachments.

## Install

```bash
npm install mu-provider
```

## Usage

```ts
import { streamChat, listModels } from "mu-provider";
import type { ProviderConfig, ChatMessage } from "mu-provider";

const config: ProviderConfig = {
  baseUrl: "http://localhost:11434/v1",
  maxTokens: 4096,
  temperature: 0.7,
  streamTimeoutMs: 30000,
};

const messages: ChatMessage[] = [
  { role: "user", content: "Hello!" },
];

for await (const chunk of streamChat(messages, config, "qwen2.5")) {
  if (chunk.type === "content") {
    process.stdout.write(chunk.text);
  } else if (chunk.type === "reasoning") {
    // model's chain-of-thought
  } else if (chunk.type === "tool_call") {
    // handle tool call
  }
}
```

## API

### `streamChat(messages, config, model, options?)`

Returns an `AsyncGenerator<StreamChunk>` that yields content, reasoning, and tool call chunks.

### `listModels(baseUrl)`

Fetches available models from the API endpoint.

## Types

- `ProviderConfig` — connection and generation settings
- `ChatMessage` — message with role, content, images, tool calls
- `StreamChunk` — `content` | `reasoning` | `tool_call`
- `ToolDefinition` — OpenAI-compatible function tool schema
- `ToolCall` — tool invocation from the model
- `ImageAttachment` — base64-encoded image with MIME type

## License

MIT
