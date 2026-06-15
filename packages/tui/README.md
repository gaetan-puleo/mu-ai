# mu-tui

Terminal UI engine and component kit used by `coding-agent` and any other mu
host that needs a TUI. Pure presentation — no agent, runtime, or provider
coupling. Provides terminal input parsing (xterm/kitty/SGR mouse, bracketed
paste, focus events), a capability detector, a layout/render core, and a
small set of components: view factories (`box`, `text`, `row`, `column`,
`flex`, `modal`, `overlay`, `toast`) plus `Editor`, `ScrollView`, `SelectList`,
and `CommandPalette`.

Entrypoint:

- `mu-tui` — the single entrypoint: `TUI`, `ProcessTerminal`, layout/render
  types, capabilities, keybindings, the input parser, and all components.
