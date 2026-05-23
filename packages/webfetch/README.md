# mu-webfetch

Plugin that adds a `webfetch` tool to mu. Fetches the contents of a URL and
returns it as markdown (default), plain text, or raw HTML — adapted from
[opencode's `webfetch` tool](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/webfetch.ts).

Originally ported from the
[`webfetch` pi-coding-agent extension](https://github.com/mariozechner/pi-coding-agent).

## Tool

- **`webfetch`** — fetch a URL.
  - `url` (string, required) — fully-formed http(s) URL.
  - `format` (string, optional) — `markdown` (default), `text`, or `html`.
    - `markdown` and `text` only transform when the response `Content-Type`
      is `text/html`; other types are returned as-is.
  - `timeout` (number, optional) — seconds, capped at 120.
  - Returns the response body as text. Errors come back as
    `{ content, error: true }`.

### Image responses

For `image/*` responses (excluding `image/svg+xml` and
`image/vnd.microsoft.icon`) the tool returns a single string of the form:

```
[image: <mime>, <byteLength> bytes from <url>]
data:<mime>;base64,<base64-payload>
```

Use sparingly — base64 inlining can blow the model's context window.

### Limits

- **Size cap**: responses larger than **5 MB** are rejected (checked against
  both the `content-length` header and the actual body length).
- **Timeout**: default **30 s**, max **120 s**. Configurable via the
  `timeout` parameter.
- **Cloudflare retry**: a `403 cf-mitigated: challenge` response triggers one
  retry with `User-Agent: mu` (the first attempt uses a regular browser UA).
- Aborting the agent (Ctrl-C) cancels in-flight requests via `AbortSignal`.

## Enable it

Add the plugin to your mu config (`~/.config/mu/config.json`):

```json
{
  "plugins": ["mu-webfetch"]
}
```

If you publish or install via npm, use `"npm:mu-webfetch"` instead — the
loader will auto-install the package on first run.

## Permissioning per agent

The tool exposes a `matchKey` of `args.url`, so agent markdown definitions
can glob-allow specific origins:

```yaml
permissions:
  webfetch:
    allow:
      - "https://github.com/**"
      - "https://*.dev/**"
    ask:
      - "**"
```

Glob matching is keyed solely on the URL — the `format` and `timeout`
parameters do not participate in permission checks.

## Implementation notes

- HTML→markdown conversion uses [turndown](https://github.com/mixmark-io/turndown)
  with `script`, `style`, `meta`, `link` stripped.
- HTML→text uses Bun's `HTMLRewriter` when available (mu's primary runtime
  is Bun); a regex-based tag stripper acts as a fallback for non-Bun hosts.
- The first request uses a Chrome-like `User-Agent` plus a quality-weighted
  `Accept` header tuned to the requested format.
