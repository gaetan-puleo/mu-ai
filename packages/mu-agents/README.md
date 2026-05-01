# mu-agents

Agent loop orchestration with a plugin system. Runs multi-turn tool-calling conversations against any OpenAI-compatible API via `mu-provider`.

## Install

```bash
npm install mu-agents
```

## Usage

```ts
import { runAgent, PluginRegistry, createBuiltinPlugin } from "mu-agents";
import type { ChatMessage, ProviderConfig } from "mu-provider";

const config: ProviderConfig = {
  baseUrl: "http://localhost:11434/v1",
  maxTokens: 4096,
  temperature: 0.7,
  streamTimeoutMs: 30000,
};

// Set up registry with built-in file/bash tools
const registry = new PluginRegistry({ cwd: process.cwd(), config: {} });
await registry.register(createBuiltinPlugin());

const messages: ChatMessage[] = [
  { role: "user", content: "Read package.json and summarize it" },
];

const controller = new AbortController();

for await (const event of runAgent(messages, config, "qwen2.5", controller.signal, registry)) {
  switch (event.type) {
    case "content":
      process.stdout.write(event.text);
      break;
    case "reasoning":
      // chain-of-thought
      break;
    case "messages":
      // updated message history (includes tool results)
      break;
    case "usage":
      console.log(`Tokens: ${event.totalTokens}`);
      break;
    case "turn_end":
      // tool calls executed, next LLM turn starting
      break;
  }
}
```

## Plugin System

Plugins can provide tools, system prompts, lifecycle hooks, slash commands, and custom agent loops.

```ts
import type { Plugin } from "mu-agents";

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

## Built-in Tools

The `createBuiltinPlugin()` provides:

- `bash` — execute shell commands
- `read_file` — read file contents
- `write_file` — write file contents
- `edit_file` — search-and-replace editing

## API

### `runAgent(messages, config, model, signal, registry)`

Runs the agent loop. Returns `AsyncGenerator<AgentEvent>`.

### `PluginRegistry`

Manages plugins, tools, hooks, and system prompts.

- `register(plugin)` / `unregister(name)`
- `loadPlugin(path, config?)` — dynamic import
- `getTools()` / `getToolDefinitions()`
- `getSystemPrompts()`
- `getHooks()`
- `shutdown()`

## License

MIT
