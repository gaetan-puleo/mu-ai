# mu-webfetch

Plugin that adds a `webfetch` tool to mu. Fetches the contents of a URL and
returns it as markdown — adapted from
[opencode's `webfetch` tool](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/webfetch.ts).

Originally ported from the
[`webfetch` pi-coding-agent extension](https://github.com/mariozechner/pi-coding-agent).

## Tool

- **`webfetch`** — fetch a URL.
  - `url` (string, required) — fully-formed http(s) URL.
  - `timeout` (number, optional) — seconds, capped at 120.
  - Returns the response body. HTML responses are converted to markdown;
    other text content types are returned as-is. Errors come back as a
    plain string prefixed with `Error:`.

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
- **Redirects**: at most 5 hops; each target is re-validated against the
  SSRF blocklist.
- **Cloudflare retry**: a `403 cf-mitigated: challenge` response triggers one
  retry with `User-Agent: mu` (the first attempt uses a regular browser UA).

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

Permissions are authored in an agent file's `tools:` frontmatter map, keyed by
tool name (globs supported), with a per-tool decision:

```yaml
tools:
  webfetch: allow # or `ask` / `deny`
```

`webfetch` can only be granted at the whole-tool level — there is no
argument-level (per-URL) scoping. Per-argument grants exist only for `skill`
(by skill name) and `bash` (by command).

## Implementation notes

- HTML→markdown conversion uses [turndown](https://github.com/mixmark-io/turndown)
  with `script`, `style`, `meta`, `link` stripped.
- The first request uses a Chrome-like `User-Agent` plus a quality-weighted
  `Accept` header that prefers markdown when servers offer it.
