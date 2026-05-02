# mu-webfetch

Plugin that adds a `webfetch` tool to mu. Fetches the contents of a URL and
returns it as plain text, with the `<head>…</head>` block stripped from HTML
responses to keep the LLM's input lean.

Ported from the
[`webfetch` pi-coding-agent extension](https://github.com/mariozechner/pi-coding-agent).

## Tool

- **`webfetch`** — fetch a URL.
  - Parameter: `url` (string, required) — the URL to fetch (HTTP/HTTPS).
  - Returns the response body as text. On non-2xx responses or network
    failures the tool returns an error result containing the status / error
    message.

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

## Notes

- Aborting the agent (Ctrl-C) cancels in-flight requests via `AbortSignal`.
- The `<head>` strip uses a single non-greedy regex; malformed HTML with
  nested or unterminated `<head>` tags is left untouched.
- No size cap: very large pages will be returned verbatim and may overflow
  the model's context window.
