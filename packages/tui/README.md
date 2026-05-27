# mu-tui

Terminal UI engine and component kit used by `coding-agent` and any other mu
host that needs a TUI. Pure presentation — no agent, runtime, or provider
coupling. Provides terminal input parsing (xterm/kitty/SGR mouse, bracketed
paste, focus events), a capability detector, a layout/render core, and a
small set of components (`Box`, `Text`, `Input`, `ScrollView`, `SelectList`,
`Modal`).

Entrypoints:

- `mu-tui` — `TUI`, `ProcessTerminal`, layout/render types, capabilities,
  keybindings, input parser.
- `mu-tui/components` — built-in components.
