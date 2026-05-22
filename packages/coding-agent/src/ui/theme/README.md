# Theme

Centralized theme configuration for `coding-agent`. The TUI library
(`mu-tui`) stays theme-agnostic; this module ships the palette, semantic
tokens, themes, and the `ThemeProvider` that distributes them.

## Layout

```
ui/theme/
├── palette.ts           # raw color palette (neutral, blue, red, ...)
├── tokens.ts            # Theme / ThemeColors / ThemeStyles / TextStyle
├── ansi.ts              # styleToAnsi, fgToAnsi, bgToAnsi, wrapWithStyle
├── ThemeProvider.ts     # holds the active theme + subscribers
├── useTheme.ts          # getTheme(ctx) helper
├── themes/
│   ├── dark.ts          # default
│   └── light.ts
└── index.ts             # barrel
```

## How tokens flow

1. `ChatApp` constructs a `ThemeProvider` and passes it as `userContext`
   into `new TUI(terminal, { userContext: provider })`.
2. `mu-tui` forwards that value into every `RenderContext.userContext` and
   `EventContext.userContext`. The TUI core treats it as opaque data.
3. Components read it via `getTheme(ctx)`:

   ```ts
   import { getTheme, styleToAnsi } from '../theme';
   render(ctx: RenderContext): string[] {
     const theme = getTheme(ctx);
     const prefix = styleToAnsi(theme.styles.body);
     return [`${prefix}${this.text}\x1b[0m`];
   }
   ```

4. `getTheme` accepts a `ThemeProvider`, a raw `Theme`, or `undefined`
   (falls back to `darkTheme`), so isolated unit tests work without
   wiring a provider.

## Runtime switching

`ThemeProvider.setTheme(next)` mutates the held theme and notifies all
subscribers. `ChatApp` subscribes to:

- Update theme-derived `LayoutStyle.backgroundColor` on layout boxes
  (the layout engine reads these once per layout pass).
- Update `Input` SGR strings (`placeholderStyle`, `textStyle`).
- Re-run `renderTranscript()` so per-message components (e.g.
  `UserMessage`) capture the new surface color into their layout.
- Call `tui.setUserContext(provider)`, which forces a full redraw.

The default keybinding `Ctrl+T` toggles between `darkTheme` and
`lightTheme`. Add more themes by copying `themes/dark.ts`, swapping
palette values, and registering a new toggle.

## Adding a token

1. Add the role to `ThemeColors` or `ThemeStyles` in `tokens.ts`.
2. Provide a value in every theme under `themes/`.
3. Consume it in a component via `getTheme(ctx).colors.<role>` or
   `theme.styles.<role>`.

## Design notes

- **Structured styles** (`{fg?, bg?, bold?, ...}`) instead of pre-rendered
  ANSI strings. `styleToAnsi` is the only place that talks SGR.
- **Capability-aware downgrade** is not implemented yet. Hex colors are
  always emitted as 24-bit SGR — see `ansi.ts` for the future hook
  (`fgToAnsi` / `bgToAnsi` could read `ctx.capabilities.colors`).
- **Layout backgrounds** (used by the `mu-tui` layout engine to paint
  padding cells) are captured at construction time. Live theme switches
  require components that use a background color to either be rebuilt
  (`renderTranscript()`) or to expose a mutable layout, which `ChatApp`
  does for `root` and `inputBox`.
