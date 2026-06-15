# mu-local-provider

LLM provider plugin for [llama-swap](https://github.com/mostlygeek/llama-swap)
servers. Speaks the OpenAI-compatible `/v1/chat/completions` API plus the
llama.cpp extras llama-swap exposes (slot selection, `id_slot`/`cache_prompt`,
`/props` for context-window info, `/tokenize` for accurate token counts).

Use it as a provider in the harness `providers` map:

```ts
import { createLocalProvider } from 'mu-local-provider';
import { createHarness } from 'mu-harness';

const harness = await createHarness({
  providers: { local: createLocalProvider({ baseUrl, model, apiKey }) },
  model: 'local/<model>',
  // …other harness options
});
```

See `LocalProviderConfig` for tunables (`openAIClient`, `onModelInfo`, `onModelLoading`, `chatTemplateKwargs`).
