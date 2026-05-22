# mu-tui — Flicker-Free TUI Core

## Overview

Zero-dependency terminal UI engine with differential rendering and synchronized output.
Built for Node.js/Bun. No React, no Ink, no external packages.

**Package:** `mu-tui`
**Location:** `packages/tui/`
**Dependencies:** None (Node.js builtins only)
**Lines of code:** 1,158 (non-test)

## Architecture

```
packages/tui/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Public exports
    ├── types.ts        # Component, Focusable, Terminal interfaces
    ├── utils.ts        # visibleWidth, truncateToWidth, wrapText, sliceByColumn
    ├── drain.ts        # drainStdin() — exit safety
    ├── terminal.ts     # ProcessTerminal — raw mode, resize, cursor
    ├── keyboard.ts     # parseInput(), probeKittyKeyboard() — input parsing
    ├── keybinds.ts     # keyMatches() — chord matching
    ├── tui.ts          # TUI class — render engine
    └── tui.test.ts     # 9 tests
```

## Anti-Flicker Mechanisms

### 1. CSI 2026 Synchronized Output
All screen updates are wrapped in atomic output:
```
\x1b[?2026h   // Begin synchronized output (buffer all writes)
... all content ...
\x1b[?2026l   // End synchronized output (flush atomically)
```
The terminal buffers every write between the markers and renders them as a single atomic update. No intermediate frames are visible.

### 2. Three-Strategy Differential Rendering
Only what changed gets re-rendered:

| Strategy | Trigger | Action |
|---|---|---|
| **First Render** | `previousLines.length === 0` | Output all lines, no clear |
| **Width/Height Changed** | Terminal resized | `\x1b[2J\x1b[H\x1b[3J` + full re-render |
| **Normal Update** | Lines changed in viewport | Move cursor to first changed line, render only changed lines |

### 3. Render Throttling
- 16ms minimum interval (~60fps cap)
- Multiple `requestRender()` calls within the same tick are coalesced into one
- Uses `process.nextTick` + `setTimeout` scheduling

### 4. Line-Level Change Detection
Finds `firstChanged` and `lastChanged` by comparing `previousLines` with `newLines`.
Only renders the changed range, not the entire screen. Critical for spinner animations where only 1 line changes per frame.

### 5. Cursor Tracking
Two cursor positions tracked separately:
- `cursorRow` — logical cursor (end of content)
- `hardwareCursorRow` — actual terminal cursor position

### 6. Viewport Tracking
`previousViewportTop` tracks the scroll offset. Changes above the viewport trigger a full redraw.

## Public API

### Terminal

```typescript
import { ProcessTerminal } from 'mu-tui';

const terminal = new ProcessTerminal();
terminal.start(onInput, onResize);
terminal.write(data);
terminal.hideCursor();
terminal.showCursor();
terminal.clearScreen();
terminal.clearLine();
terminal.clearFromCursor();
terminal.moveBy(lines);
terminal.columns;  // getter
terminal.rows;     // getter
terminal.stop();
```

### TUI

```typescript
import { TUI, type Component } from 'mu-tui';

const tui = new TUI(terminal);
tui.addChild(component);
tui.removeChild(component);
tui.setFocus(component);
tui.start();
tui.stop();
tui.requestRender();           // normal (throttled, coalesced)
tui.requestRender(true);       // force full redraw
tui.addInputListener(listener); // runs before focused component
tui.onDebug = () => console.log('debug');
tui.invalidate();              // invalidate all children
tui.setUserContext(value);     // forward an opaque app value into ctx.userContext
tui.getUserContext();          // read the current value
```

The `userContext` option (and matching setter) lets a consumer attach an
arbitrary value (e.g. a theme provider) that is forwarded into every
`RenderContext.userContext` and `EventContext.userContext`. The TUI core
treats it as opaque data. Updating it triggers a full redraw.

### Component Interface

```typescript
interface Component {
  render(width: number): string[];   // each line must not exceed width
  handleInput?(data: string): void;  // keyboard input when focused
  wantsKeyRelease?: boolean;         // opt-in for Kitty key release events
  invalidate?(): void;               // clear cached render state
}

interface Focusable extends Component {
  focused: boolean;  // set by TUI when focus changes
}
```

### Text Utilities

```typescript
import { visibleWidth, truncateToWidth, wrapText, sliceByColumn } from 'mu-tui';

visibleWidth('\x1b[31mHello\x1b[0m');           // 5 (ignores ANSI)
truncateToWidth('Hello World', 8);              // "Hello W..."
wrapText('Long text here', 20);                 // ['Long text', 'here']
sliceByColumn('Styled\x1b[31mText', 0, 5);      // column-based slice
```

### Keyboard

```typescript
import { parseInput, probeKittyKeyboard, type KeyEvent } from 'mu-tui';

const event = parseInput(rawInputString);
// Returns: { kind: 'key' | 'keyRelease' | 'mouse', key: string, ...modifiers }

const hasKitty = await probeKittyKeyboard();  // detects Kitty keyboard protocol
```

### Keybinds

```typescript
import { keyMatches, type KeyChord } from 'mu-tui';

const chord: KeyChord = { key: 'up', ctrl: false };
const match = keyMatches(chord, event);  // strict matching
```

## Edge Cases Handled

### Terminal I/O (terminal.ts)
- **Non-TTY detection** — gracefully skips raw mode if stdin/stdout aren't TTYs
- **SIGINT handling** — raw mode suppresses SIGINT; handler restores mode then re-sends
- **SIGTERM handling** — same cleanup on termination
- **Exit handler** — cleanup on process.exit
- **Stdin drain** — drains pending bytes before restoring cooked mode (prevents shell corruption from buffered Ctrl+D, Kitty events, etc.)
- **Resize events** — updates dimensions and notifies TUI

### Input Parsing (keyboard.ts)
- **Kitty keyboard protocol** — `\x1b[<code;modu` (CSI-u)
- **xterm modifyOtherKeys mode 2** — `\x1b[27;code;mod~` fallback
- **SGR mouse tracking** — `\x1b[<Cb;Cx;CyM` (button press/release/motion/wheel)
- **Key release events** — `\x1b[200u` / `\x1b[201u` (Kitty)
- **Alt-prefixed sequences** — ESC + rest → meta modifier
- **Ctrl+A-Z** — bytes 0x01-0x1a
- **Modified Enter** — xterm sends `\x1b[27;13;4~` for Ctrl+Enter, normalized to CSI-u format
- **Partial escape sequence buffering** — sequences split across chunks are reassembled
- **Kitty protocol probing** — queries terminal with `\x1b[?u`, waits for `\x1b[?Nu`

### Text Utilities (utils.ts)
- **ANSI escape sequences** — stripped for width calculation, preserved in output
- **CJK wide characters** — counted as width 2
- **Emoji** — counted as width 1 (despite being 4-byte UTF-8)
- **Zero-width characters** — counted as width 0
- **Strict wrapping** — prevents splitting wide characters at boundaries
- **Trailing ANSI codes** — extracted and re-appended after truncation

### Render Engine (tui.ts)
- **Line width overflow** — throws with crash log if any rendered line exceeds terminal width
- **Content shrink** — clears extra lines below new content end
- **Cursor position after render** — moves cursor to end of content
- **Force render state reset** — `requestRender(true)` clears all state for clean redraw
- **Render loop coalescing** — multiple rapid `requestRender()` calls produce one render
- **Stopped state** — all render operations are no-ops after `stop()`

## Escape Sequences Used

| Sequence | Purpose |
|---|---|
| `\x1b[?2026h` / `\x1b[?2026l` | Synchronized output (atomic rendering) |
| `\x1b[2J\x1b[H\x1b[3J` | Clear screen, home, clear scrollback |
| `\x1b[2K` | Clear entire line |
| `\x1b[0J` | Clear from cursor to end |
| `\x1b[nA/B` | Move cursor up/down n lines |
| `\r` | Move to column 0 |
| `\x1b[?25l` / `\x1b[?25h` | Hide/show cursor |
| `\x1b[0m` | SGR reset |
| `\x1b]8;;\x07` | Hyperlink reset |
| `\x1b[?u` | Query Kitty keyboard support |
| `\x1b[<code;modu` | Kitty keyboard protocol |
| `\x1b[27;code;mod~` | xterm modified keys |
| `\x1b[<Cb;Cx;CyM` | SGR mouse tracking |
| `\x1b[200u` / `\x1b[201u` | Kitty key release |

## File Sizes

| File | Lines | Role |
|---|---|---|
| `tui.ts` | 368 | Render engine (core) |
| `keyboard.ts` | 334 | Input parsing (Kitty, xterm, SGR mouse) |
| `utils.ts` | 187 | Text utilities (ANSI-aware) |
| `terminal.ts` | 151 | Raw terminal I/O |
| `types.ts` | 42 | Interfaces |
| `drain.ts` | 28 | Exit safety |
| `keybinds.ts` | 28 | Key chord matching |
| `index.ts` | 20 | Exports |
| **Total** | **1,158** | |

## Testing

```bash
cd packages/tui && npx vitest run
```

9 tests covering: `visibleWidth`, `truncateToWidth`, `wrapText`.

## Lint

```bash
npx biome check packages/tui
```

All clean. Suppressions used only for intentional ANSI escape sequences in regex patterns.

## Future: Components

The core is component-agnostic. Built-in components (Text, Input, Editor, SelectList, etc.)
can be added as separate modules that implement the `Component` interface.
Think of this as the rendering engine — not a widget library.
