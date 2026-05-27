# mu-local-provider

LLM provider plugin for [llama-swap](https://github.com/mostlygeek/llama-swap)
servers. Speaks the OpenAI-compatible `/v1/chat/completions` API plus the
llama.cpp extras llama-swap exposes (slot selection, `id_slot`/`cache_prompt`,
`/props` for context-window info, `/tokenize` for accurate token counts).

Use it by adding the plugin to the runtime's `plugins` list:

```ts
import { createLocalProviderPlugin } from 'mu-local-provider';

createRuntime({
  plugins: [createLocalProviderPlugin({ baseUrl, model, apiKey })],
});
```

See `LocalProviderConfig` for tunables (`streamTimeoutMs`, `getAbortSignal`,
`openAIClient`).
