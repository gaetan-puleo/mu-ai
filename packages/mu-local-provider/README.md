# mu-local-provider

Local-server-aware LLM provider plugin for mu. Speaks the OpenAI HTTP API on
the wire (any OpenAI-compatible local server works for streaming + tool
calls) but adds **server-kind detection** so the host UI can show *which*
server is serving the model and discover its runtime context window.

Supported server kinds in v1:

| Kind          | Detection probe                  | Context discovery                                                              |
|---------------|----------------------------------|--------------------------------------------------------------------------------|
| `llama-swap`  | `GET /running` returns 200 JSON  | `GET /upstream/<id>/props` → `default_generation_settings.params.n_ctx`        |
| `llama-cpp`   | `GET /props` returns 200 JSON    | same response → `default_generation_settings.params.n_ctx`                     |
| `unknown`     | both probes fail                 | unavailable                                                                    |

Both supported kinds share the canonical llama.cpp `/props` introspection
endpoint; only the URL prefix differs (`/upstream/<id>/` for llama-swap,
root for standalone llama-server).

Probes run in parallel with a 1.5 s per-endpoint timeout. The result is
cached per `baseUrl` for the lifetime of the process.

## Model identifier format

The provider canonically identifies models as a hierarchical triple:

```
local/<serverKind>/<modelId>
```

e.g. `local/llama-swap/qwen-3.6-35b`. Hosts can pass any of three forms and
the provider normalises them:

- `qwen-3.6-35b`                        — legacy short id
- `llama-swap/qwen-3.6-35b`             — kind-qualified
- `local/llama-swap/qwen-3.6-35b`       — fully qualified

See `src/modelId.ts` (`parseModelId`, `formatModelId`).

## Usage

```ts
import { Mu } from 'mu-core';
import { createLocalProviderPlugin } from 'mu-local-provider';

const plugin = createLocalProviderPlugin();
const mu = await Mu.start({
  config: { baseUrl: 'http://localhost:8080/v1', model: 'qwen-3.6-35b', providerId: 'local' },
  plugins: [plugin],
});

// Sidecar info (server kind, runtime context limit):
const info = await plugin.handle.getServerInfo();         // { kind, label, baseUrl }
const model = await plugin.handle.getModelInfo('qwen-3.6-35b'); // { id, runtimeContextLimit? }
```

The `Provider` registered with mu-core has `id: 'local'`. Hosts must set
`config.providerId = 'local'` (mu-core has no default provider).

## Caveats

- `kind: 'unknown'` is permissive — streaming and tool calling still work
  against any OpenAI-compatible server. Only context-window discovery is
  unavailable.
- llama-swap's `/upstream/<id>/props` reports the *runtime* `n_ctx` (the
  value `llama-server` was launched with, e.g. `--ctx-size 200000`). This
  is not necessarily the model's trained maximum (`n_ctx_train`), which is
  intentionally not surfaced because it is misleading for "is my context
  full?" UX.
