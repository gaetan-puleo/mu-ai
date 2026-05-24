# Terminal Protocols Encyclopedia for TUI Framework Design

**Version:** v3 — comprehensive English reference
**Scope:** terminal protocols, escape sequences, input protocols, graphics protocols, capability detection, security, and framework architecture for building a modern TUI framework.
**Date:** 2026-05-20

> This document aims to be exhaustive for the purpose of designing and implementing a serious TUI framework. Absolute exhaustiveness is not possible because terminal behavior is a living ecosystem: ECMA-48 is frozen, DEC manuals are historical, xterm keeps evolving, terminal emulators add extensions, and multiplexers / remote environments transform the stream. The correct engineering goal is a layered, source-aware, extensible reference.

---

## Table of Contents

1. [Scope, philosophy, and taxonomy](#1-scope-philosophy-and-taxonomy)
2. [The terminal stack](#2-the-terminal-stack)
3. [Historical timeline](#3-historical-timeline)
4. [Formal standards and reference families](#4-formal-standards-and-reference-families)
5. [Notation and byte grammar](#5-notation-and-byte-grammar)
6. [TTY, PTY, line discipline, and raw mode](#6-tty-pty-line-discipline-and-raw-mode)
7. [Character encoding and Unicode rendering](#7-character-encoding-and-unicode-rendering)
8. [ECMA-48 control functions](#8-ecma-48-control-functions)
9. [C0, C1, ESC, CSI, OSC, DCS, APC, PM, SOS](#9-c0-c1-esc-csi-osc-dcs-apc-pm-sos)
10. [Cursor, screen, scrolling, tabulation, and editing sequences](#10-cursor-screen-scrolling-tabulation-and-editing-sequences)
11. [SGR: text attributes and colors](#11-sgr-text-attributes-and-colors)
12. [DEC VT family protocols](#12-dec-vt-family-protocols)
13. [xterm as the modern de facto standard](#13-xterm-as-the-modern-de-facto-standard)
14. [Terminal detection and feature negotiation](#14-terminal-detection-and-feature-negotiation)
15. [terminfo, termcap, curses, and capability databases](#15-terminfo-termcap-curses-and-capability-databases)
16. [Keyboard input protocols](#16-keyboard-input-protocols)
17. [Mouse, pointer, focus, paste, and window events](#17-mouse-pointer-focus-paste-and-window-events)
18. [Image and graphics protocols](#18-image-and-graphics-protocols)
19. [OSC protocols: title, hyperlinks, clipboard, shell integration, notifications](#19-osc-protocols-title-hyperlinks-clipboard-shell-integration-notifications)
20. [DCS protocols: queries, Sixel, ReGIS, UDKs, termcap exchange](#20-dcs-protocols-queries-sixel-regis-udks-termcap-exchange)
21. [Multiplexers, remoting, and nested terminals](#21-multiplexers-remoting-and-nested-terminals)
22. [Operating-system and platform terminals](#22-operating-system-and-platform-terminals)
23. [Terminal emulator families and compatibility notes](#23-terminal-emulator-families-and-compatibility-notes)
24. [Security model for terminal protocols](#24-security-model-for-terminal-protocols)
25. [Architecture of a robust TUI framework](#25-architecture-of-a-robust-tui-framework)
26. [Recommended support tiers](#26-recommended-support-tiers)
27. [Implementation checklists](#27-implementation-checklists)
28. [Appendix A — Sequence catalog](#appendix-a--sequence-catalog)
29. [Appendix B — Capability model schema](#appendix-b--capability-model-schema)
30. [Appendix C — Parser state machine model](#appendix-c--parser-state-machine-model)
31. [Appendix D — Test strategy](#appendix-d--test-strategy)
32. [Glossary](#glossary)
33. [References](#references)

---

# 1. Scope, philosophy, and taxonomy

A TUI framework is not just a drawing library. It is a protocol implementation that sits between an application and a terminal-like endpoint. That endpoint may be a real serial terminal, a pseudo-terminal connected to a GUI emulator, a multiplexer pane, a web terminal, a remote SSH session, a Windows ConPTY, a Linux virtual console, or a chain of all of these.

The central rule is:

> A terminal protocol is an in-band byte protocol. The same stream carries printable text, control functions, input events, feature queries, responses, file/image payloads, and potentially hostile data.

A framework must therefore model terminal communication as a stateful, partially negotiated, partially guessed, and security-sensitive byte stream.

## 1.1 Classification of protocols

| Class                       | Examples                                                                                    | Status                          | Framework stance                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| Formal standards            | ASCII, ISO 646, ISO 2022, ECMA-35, ECMA-43, ECMA-48 / ISO 6429, POSIX termios, Unicode      | Standards body specifications   | Treat as the grammar and lowest common semantic layer.  |
| Historical vendor standards | DEC VT52, VT100, VT220, VT320, VT420, VT520, ReGIS, Sixel, DRCS                             | Historical manuals              | Support widely inherited behavior; document deviations. |
| De facto standards          | xterm control sequences, ncurses terminfo entries, SGR mouse, OSC 52                        | Widely implemented conventions  | Treat as practical interoperability baseline.           |
| Modern terminal extensions  | Kitty keyboard, Kitty graphics, iTerm2 images, OSC 8, OSC 133/633/1337, synchronized output | Implemented by modern emulators | Detect or gate; never assume universally available.     |
| Multiplexer protocols       | tmux passthrough, screen behavior, terminal-over-terminal forwarding                        | Transforming layers             | Support nested negotiation and passthrough.             |
| Platform-specific layers    | Windows Console API, ConPTY VT, Linux console, xterm.js, VS Code terminal                   | OS or host environment          | Model as compatibility profiles.                        |
| Framework conventions       | app-level widgets, semantic events, layout policies, focus model                            | Your abstraction                | Keep separate from raw protocol semantics.              |

## 1.2 What “complete” means for a framework

A complete framework should know:

1. the byte grammar;
2. the state machine needed to parse it;
3. the historical aliases and fallbacks;
4. the modern feature probes;
5. how to normalize input into semantic events;
6. how to render text and graphics without corrupting terminal state;
7. how to restore terminal state after crashes;
8. how to sanitize untrusted output;
9. how to operate inside tmux, screen, SSH, and Windows ConPTY;
10. how to update itself as terminal ecosystems evolve.

It should **not** hard-code one terminal, one `$TERM`, one width table, one keyboard protocol, or one image protocol.

---

# 2. The terminal stack

## 2.1 Conceptual layers

```text
Application / TUI framework
  ↓ writes bytes, reads bytes
stdio / event loop / async runtime
  ↓
TTY driver or PTY slave
  ↓
Line discipline: canonical/raw, echo, signals, flow control
  ↓
PTY master or serial line
  ↓
Terminal emulator / multiplexer / console host
  ↓
GUI window, web canvas, real hardware, remote transport
```

## 2.2 Real terminal vs terminal emulator

A physical terminal was historically a device connected over a serial line. A terminal emulator is software that implements enough of those device protocols to host command-line applications. Modern emulators implement a hybrid of:

- ECMA-48;
- DEC VT behavior;
- xterm extensions;
- Unicode rendering;
- GUI clipboard/window integration;
- optional image protocols;
- optional keyboard/mouse protocols;
- multiplexer-aware passthrough.

## 2.3 The serial constraint

The reason terminal protocols are complex is that all interaction is serialized into bytes:

- a printable `A` is just a byte or UTF-8 sequence;
- `Ctrl+A` may be byte `0x01`;
- `Escape` may be byte `0x1B`;
- `Alt+x` may be `ESC x`;
- an arrow key may be `ESC [ A`;
- a mouse click may be `ESC [ < 0 ; 10 ; 5 M`;
- an image may be a large DCS/APC/OSC payload.

The framework must disambiguate using grammar, timeouts, negotiated modes, and context.

---

# 3. Historical timeline

## 3.1 Before video terminals

- **Teleprinters / teletypes**: hardcopy devices, line-based interaction, carriage return and line feed as physical actions.
- **ASCII control characters**: BEL, BS, HT, LF, VT, FF, CR, ESC, DEL were created for device control as much as text interchange.
- **Serial lines**: baud rates, parity, flow control, and local echo shaped early protocol design.

## 3.2 Early video terminals

- **ADM-3A** influenced conventions such as cursor keys and `vi` key choices.
- **VT52** used simple escape sequences without the full ANSI/ECMA CSI grammar.
- **VT100** popularized ANSI-style control sequences and became a compatibility target.
- **VT102** refined VT100 behavior.

## 3.3 DEC VT200 and later

- **VT220** introduced richer character set handling, 8-bit controls, national replacement character sets, and better conformance to ISO/ECMA models.
- **VT240 / VT241 / VT330 / VT340** included graphics capabilities such as ReGIS and Sixel in relevant models.
- **VT320 / VT420 / VT520 / VT525** added additional editing, reporting, and display features.

## 3.4 ANSI, ECMA, ISO

- ANSI X3.64 and ECMA-48 / ISO 6429 define the control function grammar that modern ANSI escape sequences use.
- ISO 2022 / ECMA-35 define character set designation/invocation models inherited by DEC terminals.
- ECMA-43 defines 8-bit coded character set structure.

## 3.5 Unix terminal abstraction

Unix introduced the device-file view of terminals and later pseudo-terminals:

- `/dev/tty*` for physical or virtual terminals;
- PTYs for terminal emulators and remote sessions;
- termcap/terminfo to describe capabilities;
- curses/ncurses to abstract screen drawing.

## 3.6 xterm era

xterm became the most important de facto reference because:

- it implemented VT behavior;
- it added mouse tracking;
- it added OSC sequences;
- it documented control sequences thoroughly;
- many terminal emulators copied xterm behavior.

## 3.7 Modern emulator era

Modern terminals added:

- truecolor;
- hyperlinks;
- clipboard integration;
- shell integration;
- SGR mouse;
- bracketed paste;
- synchronized output;
- enhanced keyboard protocols;
- inline images;
- GPU rendering;
- remote and web terminal hosting.

---

# 4. Formal standards and reference families

## 4.1 ASCII / ISO 646

ASCII defines a 7-bit character set containing printable characters and C0 control characters. Terminal protocols still rely on ASCII-compatible byte values for ESC, BEL, CR, LF, digits, semicolons, and final bytes.

Important C0 controls:

|   Byte | Abbrev | Meaning in terminal context                                                     |
| -----: | ------ | ------------------------------------------------------------------------------- |
| `0x00` | NUL    | Ignored padding in many contexts.                                               |
| `0x07` | BEL    | Bell; also used as an OSC string terminator by many terminals.                  |
| `0x08` | BS     | Backspace.                                                                      |
| `0x09` | HT     | Horizontal tab.                                                                 |
| `0x0A` | LF     | Line feed.                                                                      |
| `0x0B` | VT     | Vertical tab, rarely meaningful in modern TUI rendering.                        |
| `0x0C` | FF     | Form feed, may clear screen in some historical contexts.                        |
| `0x0D` | CR     | Carriage return.                                                                |
| `0x0E` | SO     | Shift out; invoke G1 into GL in ISO 2022/DEC contexts.                          |
| `0x0F` | SI     | Shift in; invoke G0 into GL.                                                    |
| `0x18` | CAN    | Cancel current escape/control sequence.                                         |
| `0x1A` | SUB    | Substitute; often aborts malformed sequence.                                    |
| `0x1B` | ESC    | Escape; introduces escape sequences.                                            |
| `0x7F` | DEL    | Delete/control; often ignored as output, Backspace-ish as input depending mode. |

## 4.2 ECMA-35 / ISO 2022

Defines character code structure and extension techniques:

- character set designation into G0/G1/G2/G3;
- invocation into GL/GR;
- locking shifts and single shifts;
- escape sequence structure for character sets;
- 7-bit and 8-bit environments.

TUI relevance today:

- DEC Special Graphics uses `ESC ( 0` and `ESC ( B` style designations;
- SO/SI can switch between G0/G1 in legacy output;
- modern UTF-8 terminals often emulate just enough for old applications;
- robust parsers must recognize these sequences even if the renderer maps them to Unicode.

## 4.3 ECMA-43

Defines 8-bit coded character set structure and rules. It matters historically because ECMA-48 can be used in 7-bit, extended 7-bit, 8-bit, or extended 8-bit codes structured in accordance with ECMA-35/43.

## 4.4 ECMA-48 / ISO 6429 / ANSI X3.64

Defines control functions and their coded representations:

- C0/C1 controls;
- ESC sequences;
- CSI sequences;
- SGR;
- cursor movement;
- erase functions;
- line/character insertion/deletion;
- device status reports;
- mode setting/resetting.

It is the formal base. It does **not** define all xterm, DEC private, mouse, image, or modern OSC behavior.

## 4.5 POSIX termios

Defines terminal I/O attributes on POSIX systems:

- canonical vs noncanonical input;
- echo;
- signal generation;
- input/output transformations;
- control characters;
- flow control;
- `VMIN`/`VTIME` read behavior.

A TUI must use termios or equivalent APIs to enter raw/cbreak mode and restore the original settings.

## 4.6 Unicode

Modern terminal rendering is Unicode-based even when protocol syntax is ASCII-compatible. A TUI framework must handle:

- UTF-8 decoding;
- invalid sequences;
- combining marks;
- grapheme clusters;
- emoji ZWJ sequences;
- variation selectors;
- East Asian Width;
- ambiguous-width policy;
- bidirectional text limitations;
- font fallback and emoji presentation.

## 4.7 terminfo and termcap

`terminfo` describes terminal capabilities: how to move the cursor, clear the screen, enter alternate screen, enable colors, initialize modes, and more. It is necessary for portability but insufficient for many modern features.

---

# 5. Notation and byte grammar

## 5.1 Notation

| Notation | Meaning                                                           |
| -------- | ----------------------------------------------------------------- |
| `ESC`    | byte `0x1B`, written `\x1b`, `^[`.                                |
| `BEL`    | byte `0x07`.                                                      |
| `ST`     | String Terminator: `ESC \` in 7-bit form or `0x9C` in 8-bit form. |
| `CSI`    | Control Sequence Introducer: `ESC [` in 7-bit form or `0x9B`.     |
| `OSC`    | Operating System Command: `ESC ]` or `0x9D`.                      |
| `DCS`    | Device Control String: `ESC P` or `0x90`.                         |
| `APC`    | Application Program Command: `ESC _` or `0x9F`.                   |
| `PM`     | Privacy Message: `ESC ^` or `0x9E`.                               |
| `SOS`    | Start of String: `ESC X` or `0x98`.                               |
| `Ps`     | Single numeric parameter.                                         |
| `Pm`     | Multiple numeric parameters.                                      |
| `Pt`     | Text payload.                                                     |
| `SP`     | Space byte `0x20`; sometimes an intermediate byte.                |

## 5.2 7-bit vs 8-bit controls

Many C1 controls have two representations:

| 7-bit   |  8-bit | Name |
| ------- | -----: | ---- |
| `ESC D` | `0x84` | IND  |
| `ESC E` | `0x85` | NEL  |
| `ESC H` | `0x88` | HTS  |
| `ESC M` | `0x8D` | RI   |
| `ESC N` | `0x8E` | SS2  |
| `ESC O` | `0x8F` | SS3  |
| `ESC P` | `0x90` | DCS  |
| `ESC [` | `0x9B` | CSI  |
| `ESC ]` | `0x9D` | OSC  |
| `ESC ^` | `0x9E` | PM   |
| `ESC _` | `0x9F` | APC  |
| `ESC \` | `0x9C` | ST   |

Modern UTF-8 terminals often prefer 7-bit forms because raw 8-bit C1 bytes conflict with UTF-8 decoding assumptions. Some terminals accept C1 as Unicode code points encoded in UTF-8 rather than raw bytes; do not rely on raw 8-bit C1 in portable applications.

## 5.3 CSI grammar

A robust CSI parser should implement the ECMA-48 byte classes:

```text
CSI sequence = CSI parameter-bytes intermediate-bytes final-byte
parameter bytes     = 0x30..0x3F   digits, ;, :, ?, >, =, <
intermediate bytes  = 0x20..0x2F   space and punctuation intermediates
final byte          = 0x40..0x7E
```

Examples:

```text
ESC [ 31 m       SGR red foreground
ESC [ ? 25 l     DEC private mode: hide cursor
ESC [ 1 ; 10 H   CUP row 1, column 10
ESC [ > 4 ; 2 m  xterm modifyOtherKeys related parameter space, depending final
```

## 5.4 OSC grammar

```text
OSC sequence = OSC command ; payload terminator
terminator   = BEL or ST
```

Examples:

```text
ESC ] 0 ; title BEL
ESC ] 8 ; ; https://example.com ESC \ text ESC ] 8 ; ; ESC \
ESC ] 52 ; c ; BASE64 BEL
```

A secure parser must impose maximum payload sizes and timeouts for unterminated OSC strings.

## 5.5 DCS/APC/PM/SOS string grammar

DCS, APC, PM, and SOS are string controls terminated by ST. They may contain large payloads.

```text
DCS = ESC P params intermediates final data ST
APC = ESC _ data ST
PM  = ESC ^ data ST
SOS = ESC X data ST
```

Kitty graphics uses APC-style `ESC _ G ... ESC \`. Sixel uses DCS. XTGETTCAP uses DCS.

---

# 6. TTY, PTY, line discipline, and raw mode

## 6.1 TTY concepts

A terminal device is not a passive pipe. The kernel line discipline may transform bytes before the application sees them or before the terminal sees output.

Common transformations:

- input CR to NL mapping;
- output NL to CRLF mapping;
- echo;
- canonical line buffering;
- erase/kill processing;
- signal generation for `Ctrl+C`, `Ctrl+Z`, `Ctrl+\`;
- XON/XOFF flow control;
- stripping/parity handling.

A TUI framework must control these settings.

## 6.2 Canonical mode

In canonical mode:

- input is line-buffered;
- editing characters are processed by the kernel;
- `read()` returns after newline, EOF, or line discipline events;
- control characters may become signals;
- not suitable for interactive full-screen TUIs.

## 6.3 Cbreak mode

Cbreak mode usually means:

- noncanonical input;
- signals may remain enabled;
- echo disabled;
- bytes delivered sooner.

Good for line editors and simple interactive programs.

## 6.4 Raw mode

Raw mode usually disables:

- canonical processing;
- echo;
- signal generation;
- input translations;
- output translations;
- flow control if desired.

A typical POSIX raw mode changes flags such as:

```text
iflag: disable BRKINT, ICRNL, INPCK, ISTRIP, IXON
oflag: disable OPOST
cflag: set CS8
lflag: disable ECHO, ICANON, IEXTEN, ISIG
cc:    VMIN/VTIME according to event-loop strategy
```

Different applications choose different degrees of rawness. For example, a framework may keep `ISIG` enabled in cbreak mode for default signal behavior, or disable it when using enhanced keyboard protocols where `Ctrl+C` is expected as a key event.

## 6.5 VMIN and VTIME

In noncanonical mode:

| VMIN | VTIME | Behavior                                                  |
| ---: | ----: | --------------------------------------------------------- |
|  `0` |   `0` | Polling read; returns immediately.                        |
| `>0` |   `0` | Blocking read until at least VMIN bytes.                  |
|  `0` |  `>0` | Timeout read; returns when data arrives or timer expires. |
| `>0` |  `>0` | Inter-byte timeout behavior after first byte.             |

For TUIs, common strategies are:

- nonblocking FD + event loop;
- `VMIN=0, VTIME=1` for simple loops;
- `VMIN=1, VTIME=0` with separate readiness polling.

## 6.6 PTYs

A pseudo-terminal has:

- a **slave** side that looks like a terminal to the child process;
- a **master** side used by the emulator, multiplexer, or parent process.

SSH, tmux, screen, xterm.js backends, and test harnesses often use PTYs.

## 6.7 Window size

Window size is usually obtained through:

- `ioctl(TIOCGWINSZ)` on POSIX;
- `SIGWINCH` on resize;
- terminal queries such as `CSI 18 t` or `CSI 14 t` when supported;
- Windows console APIs or ConPTY events.

The framework should treat `ioctl` / OS events as authoritative when available and use terminal queries as optional probes.

## 6.8 Cleanup and restoration

Always restore:

- termios modes;
- alternate screen state;
- cursor visibility;
- cursor shape;
- mouse modes;
- focus mode;
- bracketed paste;
- synchronized output;
- SGR attributes;
- keyboard protocol flags if pushed.

Use `atexit`, signal handlers, panic hooks, RAII guards, or `defer`-style constructs.

---

# 7. Character encoding and Unicode rendering

## 7.1 Bytes are not characters

A terminal receives bytes. The emulator decodes them as:

- ASCII in historical modes;
- ISO 2022 designated sets in legacy modes;
- UTF-8 in nearly all modern emulators;
- sometimes locale-dependent encodings in older environments.

A modern framework should emit UTF-8 by default but account for legacy charsets if `$TERM`, locale, or terminfo indicates constraints.

## 7.2 ISO 2022 and DEC character sets

Important sequences:

| Sequence      | Meaning                                  |
| ------------- | ---------------------------------------- |
| `ESC ( B`     | Designate ASCII into G0.                 |
| `ESC ( 0`     | Designate DEC Special Graphics into G0.  |
| `ESC ) B`     | Designate ASCII into G1.                 |
| `ESC ) 0`     | Designate DEC Special Graphics into G1.  |
| `SO` / `0x0E` | Shift out; invoke G1 into GL.            |
| `SI` / `0x0F` | Shift in; invoke G0 into GL.             |
| `ESC N`       | SS2; single shift G2 for next character. |
| `ESC O`       | SS3; single shift G3 for next character. |

DEC Special Graphics maps ASCII-like bytes to line-drawing symbols. A modern renderer can map these to Unicode box-drawing characters.

## 7.3 Unicode scalar values, code points, and graphemes

A code point is not always a displayed character. A displayed user-perceived character may be an extended grapheme cluster:

```text
letter + combining mark
emoji + variation selector
emoji + skin tone modifier
emoji ZWJ sequence
regional indicator pair
```

A TUI layout engine must measure and slice by grapheme clusters, not bytes or scalar values.

## 7.4 Cell width

Terminals render text in cells. A grapheme may have width:

- 0: combining mark, control, zero-width joiner components;
- 1: most Latin text;
- 2: CJK wide/fullwidth, many emoji;
- ambiguous: characters whose width depends on locale/font/terminal policy.

A framework needs a width policy:

```text
width(grapheme, environment) -> 0 | 1 | 2 | invalid
```

Inputs:

- Unicode East Asian Width data;
- emoji presentation rules;
- locale, especially CJK locales;
- terminal-specific emoji width behavior;
- user override.

## 7.5 Variation selectors

- `U+FE0E` requests text presentation.
- `U+FE0F` requests emoji presentation.

Terminals vary. A symbol plus `FE0F` may become width 2 in some emulators.

## 7.6 Combining marks

Combining marks have width 0 but still affect previous base cells. Problems:

- combining mark at column 0;
- combining mark after wide character;
- erase and overwrite behavior;
- cursor movement over composed glyphs;
- terminal renderer bugs.

## 7.7 Emoji ZWJ sequences

A sequence such as `person + ZWJ + laptop` may be one glyph with width 2. A framework cannot assume one code point equals one cell.

## 7.8 Bidirectional text

Most terminal emulators historically treat the grid as logical left-to-right cells. Some environments may shape or reorder complex scripts, but terminal bidi behavior is inconsistent. A TUI framework should explicitly document bidi support level.

## 7.9 Shaping and ligatures

Terminals may apply font shaping and ligatures. From a protocol perspective, the grid remains cell-based. The framework should not depend on ligatures for layout correctness.

---

# 8. ECMA-48 control functions

ECMA-48 divides control functions into:

1. C0 controls;
2. C1 controls;
3. control sequences;
4. escape sequences;
5. modes.

## 8.1 Common ECMA-48 functions relevant to TUIs

| Mnemonic | Sequence          | Meaning                             |
| -------- | ----------------- | ----------------------------------- |
| CUU      | `CSI n A`         | Cursor up.                          |
| CUD      | `CSI n B`         | Cursor down.                        |
| CUF      | `CSI n C`         | Cursor forward.                     |
| CUB      | `CSI n D`         | Cursor backward.                    |
| CNL      | `CSI n E`         | Cursor next line.                   |
| CPL      | `CSI n F`         | Cursor preceding line.              |
| CHA      | `CSI n G`         | Cursor horizontal absolute.         |
| CUP      | `CSI row ; col H` | Cursor position.                    |
| CHT      | `CSI n I`         | Cursor horizontal tab.              |
| ED       | `CSI n J`         | Erase in display.                   |
| EL       | `CSI n K`         | Erase in line.                      |
| IL       | `CSI n L`         | Insert lines.                       |
| DL       | `CSI n M`         | Delete lines.                       |
| DCH      | `CSI n P`         | Delete characters.                  |
| SU       | `CSI n S`         | Scroll up.                          |
| SD       | `CSI n T`         | Scroll down.                        |
| ECH      | `CSI n X`         | Erase characters.                   |
| CBT      | `CSI n Z`         | Cursor backward tab.                |
| HPA      | `CSI n ``         | Horizontal position absolute.       |
| HPR      | `CSI n a`         | Horizontal position relative.       |
| REP      | `CSI n b`         | Repeat preceding graphic character. |
| DA       | `CSI c`           | Primary device attributes.          |
| VPA      | `CSI n d`         | Vertical position absolute.         |
| VPR      | `CSI n e`         | Vertical position relative.         |
| HVP      | `CSI row ; col f` | Horizontal and vertical position.   |
| TBC      | `CSI n g`         | Tab clear.                          |
| SM       | `CSI n h`         | Set mode.                           |
| RM       | `CSI n l`         | Reset mode.                         |
| SGR      | `CSI ... m`       | Select graphic rendition.           |
| DSR      | `CSI n`           | Device status report.               |
| SCP      | `CSI s`           | Save cursor, non-DEC form.          |
| RCP      | `CSI u`           | Restore cursor, non-DEC form.       |

## 8.2 Parameter defaults

Defaults matter:

| Pattern                   | Typical default |
| ------------------------- | --------------- |
| missing count in movement | 1               |
| missing row/column in CUP | 1;1             |
| `CSI J`                   | `CSI 0 J`       |
| `CSI K`                   | `CSI 0 K`       |
| `CSI m`                   | `CSI 0 m`       |

A parser should preserve raw parameter structure for unknown sequences while semantic handlers can apply defaults.

## 8.3 Private parameters

Parameter bytes may include private prefixes:

| Prefix             | Common owner                                           |
| ------------------ | ------------------------------------------------------ |
| `?`                | DEC private modes, xterm private extensions.           |
| `>`                | Secondary DA, xterm modifyOtherKeys, private controls. |
| `!`                | Soft terminal reset and related private forms.         |
| space intermediate | Controls such as cursor style in `CSI Ps SP q`.        |

---

# 9. C0, C1, ESC, CSI, OSC, DCS, APC, PM, SOS

## 9.1 C0 behavior in output

| C0  | Byte | Common behavior                                   |
| --- | ---: | ------------------------------------------------- |
| NUL | `00` | Ignore.                                           |
| BEL | `07` | Bell/alert; terminates OSC in legacy form.        |
| BS  | `08` | Move cursor left one column, no erase.            |
| HT  | `09` | Move to next tab stop.                            |
| LF  | `0A` | Move down one row; scrolling at bottom margin.    |
| VT  | `0B` | Often treated like LF or ignored.                 |
| FF  | `0C` | Often treated like LF or clear in older contexts. |
| CR  | `0D` | Move to column 1.                                 |
| SO  | `0E` | Invoke G1.                                        |
| SI  | `0F` | Invoke G0.                                        |
| CAN | `18` | Cancel active sequence.                           |
| SUB | `1A` | Substitute/cancel active sequence.                |
| ESC | `1B` | Begin escape sequence.                            |
| DEL | `7F` | Usually ignored in output.                        |

## 9.2 ESC Fe sequences

| Sequence | Name | Meaning                                                                   |
| -------- | ---- | ------------------------------------------------------------------------- |
| `ESC D`  | IND  | Index: move down, scroll if needed.                                       |
| `ESC E`  | NEL  | Next line: CR + LF-like.                                                  |
| `ESC H`  | HTS  | Set horizontal tab stop.                                                  |
| `ESC M`  | RI   | Reverse index: move up, reverse-scroll if needed.                         |
| `ESC N`  | SS2  | Single shift G2.                                                          |
| `ESC O`  | SS3  | Single shift G3; also starts SS3 function key sequences such as `ESC OP`. |
| `ESC P`  | DCS  | Device Control String.                                                    |
| `ESC [`  | CSI  | Control Sequence Introducer.                                              |
| `ESC ]`  | OSC  | Operating System Command.                                                 |
| `ESC X`  | SOS  | Start of String.                                                          |
| `ESC ^`  | PM   | Privacy Message.                                                          |
| `ESC _`  | APC  | Application Program Command.                                              |
| `ESC \`  | ST   | String Terminator.                                                        |

## 9.3 ESC character set designation

| Sequence  | Meaning                               |
| --------- | ------------------------------------- |
| `ESC ( F` | Designate 94-character set F into G0. |
| `ESC ) F` | Designate into G1.                    |
| `ESC * F` | Designate into G2.                    |
| `ESC + F` | Designate into G3.                    |
| `ESC - F` | Designate 96-character set into G1.   |
| `ESC . F` | Designate 96-character set into G2.   |
| `ESC / F` | Designate 96-character set into G3.   |

Common final bytes:

| Final | Set                                                       |
| ----- | --------------------------------------------------------- |
| `B`   | ASCII / US.                                               |
| `0`   | DEC Special Graphics.                                     |
| `A`   | UK in some DEC contexts.                                  |
| `<`   | DEC supplemental or specific legacy sets depending model. |

## 9.4 OSC termination rules

A framework should accept both:

```text
OSC ... BEL
OSC ... ST
```

But when emitting, prefer `ST` for new code unless compatibility with older terminals requires BEL.

## 9.5 Parser error handling

A robust parser:

- is byte-oriented;
- has a ground state;
- recognizes C0 anywhere;
- cancels on CAN/SUB;
- imposes length limits on string controls;
- times out incomplete strings if reading interactively;
- treats unknown complete sequences as unknown events, not fatal errors;
- resets to ground on malformed sequences according to an xterm-like strategy.

---

# 10. Cursor, screen, scrolling, tabulation, and editing sequences

## 10.1 Cursor movement

| Sequence      | Name | Description              |
| ------------- | ---- | ------------------------ |
| `CSI n A`     | CUU  | Up n rows.               |
| `CSI n B`     | CUD  | Down n rows.             |
| `CSI n C`     | CUF  | Forward n columns.       |
| `CSI n D`     | CUB  | Back n columns.          |
| `CSI n E`     | CNL  | Down n rows to column 1. |
| `CSI n F`     | CPL  | Up n rows to column 1.   |
| `CSI n G`     | CHA  | Column n.                |
| `CSI r ; c H` | CUP  | Row r, column c.         |
| `CSI r ; c f` | HVP  | Row r, column c.         |
| `CSI n d`     | VPA  | Row n, current column.   |
| `CSI n e`     | VPR  | Down n rows.             |
| `CSI n a`     | HPR  | Forward n columns.       |

Coordinates are usually 1-based in protocol space.

## 10.2 Save and restore cursor

| Sequence | Origin         | Description                    |
| -------- | -------------- | ------------------------------ |
| `ESC 7`  | DEC            | Save cursor and attributes.    |
| `ESC 8`  | DEC            | Restore cursor and attributes. |
| `CSI s`  | SCO/xterm-like | Save cursor.                   |
| `CSI u`  | SCO/xterm-like | Restore cursor.                |

Prefer DEC `ESC 7`/`ESC 8` or terminfo capabilities when portability matters. Be aware that `CSI u` also conflicts conceptually with keyboard protocols in input direction; output parser context disambiguates by stream direction.

## 10.3 Erasing

| Sequence  | Name       | Meaning                                |
| --------- | ---------- | -------------------------------------- |
| `CSI 0 J` | ED 0       | Erase from cursor to end of display.   |
| `CSI 1 J` | ED 1       | Erase from start of display to cursor. |
| `CSI 2 J` | ED 2       | Erase entire display.                  |
| `CSI 3 J` | xterm ED 3 | Erase scrollback/saved lines.          |
| `CSI 0 K` | EL 0       | Erase from cursor to end of line.      |
| `CSI 1 K` | EL 1       | Erase from start of line to cursor.    |
| `CSI 2 K` | EL 2       | Erase entire line.                     |
| `CSI n X` | ECH        | Erase n characters.                    |

ED/EL clear cells using current background rendition in many emulators; behavior can vary.

## 10.4 Inserting and deleting

| Sequence  | Name | Meaning                    |
| --------- | ---- | -------------------------- |
| `CSI n @` | ICH  | Insert n blank characters. |
| `CSI n P` | DCH  | Delete n characters.       |
| `CSI n L` | IL   | Insert n lines.            |
| `CSI n M` | DL   | Delete n lines.            |

These operate within margins/scroll regions depending terminal state.

## 10.5 Scrolling

| Sequence             | Name          | Meaning                                             |
| -------------------- | ------------- | --------------------------------------------------- |
| `CSI n S`            | SU            | Scroll up n lines.                                  |
| `CSI n T`            | SD            | Scroll down n lines.                                |
| `ESC D`              | IND           | Index; scroll up at bottom margin.                  |
| `ESC M`              | RI            | Reverse index; scroll down at top margin.           |
| `CSI top ; bottom r` | DECSTBM       | Set vertical scroll region.                         |
| `CSI r`              | DECSTBM reset | Reset vertical margins.                             |
| `CSI ? 69 h`         | DECLRMM       | Enable left/right margins in xterm/DEC-style modes. |
| `CSI left ; right s` | DECSLRM       | Set left/right margins when DECLRMM enabled.        |

Scroll regions are essential for efficient terminal widgets but complicate rendering state.

## 10.6 Tabs

| Sequence  | Name  | Meaning                           |
| --------- | ----- | --------------------------------- |
| `HT`      | HT    | Move to next tab stop.            |
| `ESC H`   | HTS   | Set tab stop.                     |
| `CSI 0 g` | TBC 0 | Clear tab stop at current column. |
| `CSI 3 g` | TBC 3 | Clear all tab stops.              |
| `CSI n I` | CHT   | Forward n tab stops.              |
| `CSI n Z` | CBT   | Back n tab stops.                 |

Most TUIs avoid depending on tabs for layout and render spaces explicitly.

## 10.7 Wrapping and pending wrap

Auto-wrap mode (`DECAWM`, `CSI ? 7 h/l`) controls wrapping at the right margin. Many terminals have a pending-wrap state after writing the last column. This affects diff renderers dramatically.

Recommendations:

- avoid writing printable characters in the last column unless necessary;
- use explicit cursor moves after full-width writes;
- know whether your renderer assumes auto-wrap;
- test wide characters at the right edge.

---

# 11. SGR: text attributes and colors

SGR is `CSI ... m`. Empty parameters or parameter `0` reset rendition.

## 11.1 Core text attributes

|  Code | Meaning                                           |
| ----: | ------------------------------------------------- |
|     0 | Reset all attributes.                             |
|     1 | Bold or increased intensity.                      |
|     2 | Faint/dim.                                        |
|     3 | Italic.                                           |
|     4 | Underline.                                        |
|     5 | Slow blink.                                       |
|     6 | Rapid blink, rarely supported.                    |
|     7 | Reverse video.                                    |
|     8 | Conceal/invisible.                                |
|     9 | Crossed-out/strikethrough.                        |
|    10 | Primary/default font.                             |
| 11–19 | Alternative fonts, rarely meaningful.             |
|    20 | Fraktur/Gothic, rarely supported.                 |
|    21 | Doubly underlined or bold off depending terminal. |
|    22 | Normal intensity; clears bold and faint.          |
|    23 | Not italic/fraktur.                               |
|    24 | Not underlined.                                   |
|    25 | Not blinking.                                     |
|    27 | Not reversed.                                     |
|    28 | Reveal.                                           |
|    29 | Not crossed-out.                                  |
|    53 | Overline.                                         |
|    55 | Not overlined.                                    |

## 11.2 8-color and bright color palette

Foreground:

|  Code | Color                      |
| ----: | -------------------------- |
|    30 | Black                      |
|    31 | Red                        |
|    32 | Green                      |
|    33 | Yellow                     |
|    34 | Blue                       |
|    35 | Magenta                    |
|    36 | Cyan                       |
|    37 | White                      |
|    39 | Default foreground         |
| 90–97 | Bright foreground variants |

Background:

|    Code | Color                      |
| ------: | -------------------------- |
|   40–47 | Standard background colors |
|      49 | Default background         |
| 100–107 | Bright background variants |

## 11.3 256-color mode

```text
CSI 38 ; 5 ; index m   foreground, index 0..255
CSI 48 ; 5 ; index m   background, index 0..255
```

Common palette layout:

- 0–15: ANSI colors;
- 16–231: 6×6×6 color cube;
- 232–255: grayscale ramp.

## 11.4 Truecolor

```text
CSI 38 ; 2 ; r ; g ; b m   foreground
CSI 48 ; 2 ; r ; g ; b m   background
```

Colon variants also exist:

```text
CSI 38 : 2 : r : g : b m
CSI 48 : 2 : r : g : b m
```

A robust parser should accept both semicolon and colon forms where appropriate.

## 11.5 Underline styles and colors

Modern terminals may support:

| Sequence                   | Meaning                    |
| -------------------------- | -------------------------- |
| `CSI 4 : 0 m`              | No underline.              |
| `CSI 4 : 1 m`              | Single underline.          |
| `CSI 4 : 2 m`              | Double underline.          |
| `CSI 4 : 3 m`              | Curly/wavy underline.      |
| `CSI 4 : 4 m`              | Dotted underline.          |
| `CSI 4 : 5 m`              | Dashed underline.          |
| `CSI 58 ; 5 ; n m`         | 256-color underline color. |
| `CSI 58 ; 2 ; r ; g ; b m` | RGB underline color.       |
| `CSI 59 m`                 | Default underline color.   |

Some terminals use different ordering for dotted/dashed/curly variants; detect or treat as best-effort.

## 11.6 Ideogram attributes

ECMA-48 includes ideogram attributes such as:

| Code | Meaning                                              |
| ---: | ---------------------------------------------------- |
|   60 | Ideogram underline or right side line.               |
|   61 | Ideogram double underline or double right side line. |
|   62 | Ideogram overline or left side line.                 |
|   63 | Ideogram double overline or double left side line.   |
|   64 | Ideogram stress marking.                             |
|   65 | Ideogram attributes off.                             |

Rarely supported in modern terminal emulators.

## 11.7 Font attributes

SGR 10–19 select primary/alternate fonts in ECMA-48, but most terminal emulators ignore them or use private mechanisms for font control. Do not use these for TUI semantics.

## 11.8 Attribute interaction pitfalls

- `SGR 21` may mean double underline or bold off.
- Bold may change intensity or font weight depending configuration.
- Bright colors may be produced by bold in legacy terminals.
- Italic may be unsupported or mapped to reverse in old terminfo entries.
- Dim and bright combinations vary.
- `SGR 0` resets all attributes including hyperlinks in some terminals? OSC 8 is separate; close hyperlinks explicitly.

---

# 12. DEC VT family protocols

## 12.1 VT52

VT52 predates ANSI/ECMA CSI style. Examples:

| Sequence        | Meaning                                       |
| --------------- | --------------------------------------------- |
| `ESC A`         | Cursor up.                                    |
| `ESC B`         | Cursor down.                                  |
| `ESC C`         | Cursor right.                                 |
| `ESC D`         | Cursor left.                                  |
| `ESC H`         | Cursor home.                                  |
| `ESC J`         | Erase to end of screen.                       |
| `ESC K`         | Erase to end of line.                         |
| `ESC Y row col` | Direct cursor address with row/column offset. |
| `ESC Z`         | Identify; terminal response.                  |
| `ESC =`         | Alternate keypad mode.                        |
| `ESC >`         | Numeric keypad mode.                          |
| `ESC <`         | Enter ANSI mode on VT100-like terminals.      |

A modern framework usually does not target VT52, but a parser may see fragments in terminfo for old entries.

## 12.2 VT100 / VT102 fundamentals

Key features:

- ANSI-like CSI sequences;
- DEC private modes;
- origin mode;
- auto-wrap;
- keypad modes;
- character set designation;
- scrolling region;
- cursor save/restore;
- status reports.

## 12.3 VT200+ features

VT200 and later introduced:

- 8-bit controls;
- more character sets;
- national replacement character sets;
- device control strings;
- user-defined keys;
- rectangular editing in later models;
- reports for conformance and terminal parameters;
- Sixel/ReGIS on graphics-capable models.

## 12.4 DEC private modes

DEC private modes use:

```text
CSI ? Ps h   set
CSI ? Ps l   reset
CSI ? Ps s   save, in some xterm contexts
CSI ? Ps r   restore, in some xterm contexts
```

Important modes:

| Mode | Name                                     | Meaning                                       |
| ---: | ---------------------------------------- | --------------------------------------------- |
|    1 | DECCKM                                   | Application cursor keys.                      |
|    2 | DECANM                                   | ANSI/VT52 mode, historical.                   |
|    3 | DECCOLM                                  | 132-column mode, often disabled.              |
|    4 | DECSCLM                                  | Smooth scrolling, historical.                 |
|    5 | DECSCNM                                  | Reverse video.                                |
|    6 | DECOM                                    | Origin mode; coordinates relative to margins. |
|    7 | DECAWM                                   | Auto-wrap mode.                               |
|    8 | DECARM                                   | Auto-repeat keys, historical.                 |
|   12 | Cursor blink                             | xterm cursor blinking private mode.           |
|   25 | DECTCEM                                  | Show/hide cursor.                             |
|   40 | Allow 80/132 mode                        | xterm resource controlled.                    |
|   45 | Reverse-wraparound                       | xterm.                                        |
|   66 | DECNKM                                   | Application keypad mode.                      |
|   67 | DECBKM                                   | Backarrow sends BS vs DEL.                    |
|   69 | DECLRMM                                  | Left/right margin mode.                       |
|   95 | DECNCSM                                  | No clear on column mode change, VT510+.       |
| 1000 | Mouse normal tracking                    | xterm.                                        |
| 1002 | Mouse button-event tracking              | xterm.                                        |
| 1003 | Mouse any-event tracking                 | xterm.                                        |
| 1004 | Focus event tracking                     | xterm.                                        |
| 1005 | UTF-8 mouse mode                         | xterm, obsolete/problematic.                  |
| 1006 | SGR mouse mode                           | xterm, recommended.                           |
| 1007 | Alternate scroll mode                    | xterm.                                        |
| 1015 | urxvt mouse mode                         | rxvt-unicode extension.                       |
| 1016 | SGR pixel mouse                          | xterm extension.                              |
| 1034 | Meta sends Escape                        | xterm.                                        |
| 1035 | Enable special modifiers for Alt/NumLock | xterm.                                        |
| 1036 | Meta sends Escape variant                | xterm.                                        |
| 1039 | Alt sends Escape                         | xterm.                                        |
| 1047 | Alternate screen buffer                  | xterm.                                        |
| 1048 | Save/restore cursor                      | xterm.                                        |
| 1049 | Alternate screen + cursor save           | xterm.                                        |
| 2004 | Bracketed paste                          | xterm.                                        |
| 2026 | Synchronized output                      | modern extension.                             |

## 12.5 Application cursor keys

When DECCKM is set, arrow keys may change from CSI to SS3 forms:

| Key   | Normal  | Application mode    |
| ----- | ------- | ------------------- |
| Up    | `CSI A` | `SS3 A` / `ESC O A` |
| Down  | `CSI B` | `ESC O B`           |
| Right | `CSI C` | `ESC O C`           |
| Left  | `CSI D` | `ESC O D`           |

Applications enable this when they want keypad/cursor semantic distinction.

## 12.6 Application keypad mode

Numeric keypad sends either numbers/operators or application sequences depending mode. Historical examples:

| Key          | Application keypad sequence |
| ------------ | --------------------------- |
| PF1          | `ESC O P`                   |
| PF2          | `ESC O Q`                   |
| PF3          | `ESC O R`                   |
| PF4          | `ESC O S`                   |
| Keypad 0     | `ESC O p`                   |
| Keypad 1     | `ESC O q`                   |
| Keypad Enter | `ESC O M`                   |

Modern TUIs rarely need raw keypad distinction except editors and terminal compatibility layers.

## 12.7 DEC reports and queries

| Query            | Response               | Meaning                              |
| ---------------- | ---------------------- | ------------------------------------ |
| `CSI c`          | `CSI ? ... c`          | Primary Device Attributes.           |
| `CSI > c`        | `CSI > Pp ; Pv ; Pc c` | Secondary Device Attributes.         |
| `CSI = c`        | varies                 | Tertiary DA in some terminals.       |
| `CSI 5 n`        | `CSI 0 n`              | Device status OK.                    |
| `CSI 6 n`        | `CSI row ; col R`      | Cursor position report.              |
| `CSI ? Ps $ p`   | `CSI ? Ps ; Pm $ y`    | Request private mode state (DECRQM). |
| `DCS $ q ... ST` | `DCS ... ST`           | Request status string (DECRQSS).     |

Responses are injected into the input stream. A framework must route them to a query manager, not to normal key handling.

## 12.8 Rectangular editing

Later DEC terminals and xterm support rectangular operations useful for block editing:

| Sequence                         | Name    | Meaning                           |
| -------------------------------- | ------- | --------------------------------- |
| `CSI Pt ; Pl ; Pb ; Pr ; Pp $ x` | DECFRA  | Fill rectangular area.            |
| `CSI Pt ; Pl ; Pb ; Pr $ z`      | DECERA  | Erase rectangular area.           |
| `CSI Pt ; Pl ; Pb ; Pr $ {`      | DECSERA | Selective erase rectangular area. |
| `CSI Ps ; Pt ; Pl ; Pb ; Pr $ v` | DECCRA  | Copy rectangular area.            |

Support varies; a framework should not require these for basic rendering.

## 12.9 Cursor style

Common xterm/DEC-style cursor shape:

```text
CSI Ps SP q
```

| Ps | Shape               |
| -: | ------------------- |
|  0 | Terminal default.   |
|  1 | Blinking block.     |
|  2 | Steady block.       |
|  3 | Blinking underline. |
|  4 | Steady underline.   |
|  5 | Blinking bar.       |
|  6 | Steady bar.         |

---

# 13. xterm as the modern de facto standard

xterm is not a formal standards body, but its control sequence documentation is the practical reference for many modern terminals.

## 13.1 What xterm adds beyond ECMA-48/DEC

- mouse protocols;
- OSC palette and title controls;
- window manipulation controls;
- alternate screen conventions;
- bracketed paste;
- focus events;
- modifyOtherKeys;
- SGR mouse;
- 256-color and truecolor conventions;
- XTGETTCAP;
- Sixel/ReGIS integration when configured;
- private mode reporting.

## 13.2 Window operations

xterm-style window operations use `CSI ... t`.

| Sequence                | Meaning                               |
| ----------------------- | ------------------------------------- |
| `CSI 8 ; rows ; cols t` | Resize text area in characters.       |
| `CSI 14 t`              | Report text area size in pixels.      |
| `CSI 16 t`              | Report character cell size in pixels. |
| `CSI 18 t`              | Report text area size in characters.  |
| `CSI 22 ; Ps t`         | Save window title/icon title.         |
| `CSI 23 ; Ps t`         | Restore window title/icon title.      |

Many terminals restrict or disable window operations for security/user preference.

## 13.3 xterm color controls via OSC

| OSC                       | Meaning                 |
| ------------------------- | ----------------------- |
| `OSC 4 ; index ; spec ST` | Set palette color.      |
| `OSC 4 ; index ; ? ST`    | Query palette color.    |
| `OSC 10 ; spec ST`        | Set foreground color.   |
| `OSC 10 ; ? ST`           | Query foreground color. |
| `OSC 11 ; spec ST`        | Set background color.   |
| `OSC 12 ; spec ST`        | Set cursor color.       |
| `OSC 104 ; index ST`      | Reset palette color(s). |
| `OSC 110 ST`              | Reset foreground.       |
| `OSC 111 ST`              | Reset background.       |
| `OSC 112 ST`              | Reset cursor color.     |

Color specs may be names or `rgb:RR/GG/BB` style strings depending terminal.

## 13.4 xterm modifyOtherKeys

`modifyOtherKeys` attempts to report modifiers for keys that historically collapsed into ambiguous bytes.

Forms include:

```text
CSI > 4 ; mode m     set modifyOtherKeys resource-like mode in newer docs/variants
CSI > 4 m            reset/query variants depending implementation
CSI 27 ; mod ; code ~
CSI code ; mod u     CSI-u-like form in some modes
```

Because behavior differs across versions and emulators, prefer Kitty keyboard protocol where supported, and use `modifyOtherKeys` only behind a compatibility profile.

## 13.5 xterm parser model

xterm uses a state machine. This matters because regex-based parsing fails on:

- split sequences across reads;
- C0 controls inside sequences;
- partial OSC/DCS payloads;
- malformed controls;
- unknown but syntactically valid sequences;
- mixed input events and query responses.

---

# 14. Terminal detection and feature negotiation

## 14.1 Detection sources

| Source                | Strength                                                                                         | Problems                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `$TERM`               | Basic compatibility profile                                                                      | Often lies under tmux/SSH; too coarse.                           |
| terminfo              | Good for classic capabilities                                                                    | Missing many modern protocols.                                   |
| environment variables | Useful hints: `TERM_PROGRAM`, `WT_SESSION`, `KITTY_WINDOW_ID`, `WEZTERM_EXECUTABLE`, `COLORTERM` | Nonstandard, spoofable, incomplete.                              |
| DA/DSR/DECRQM probes  | Active confirmation                                                                              | Responses can be blocked/transformed; must parse asynchronously. |
| XTGETTCAP             | Rich capability query in supporting terminals                                                    | Not universal; often filtered by multiplexers.                   |
| trial rendering       | Practical tests                                                                                  | Intrusive; not suitable for all features.                        |
| user config           | Reliable override                                                                                | Requires documentation and persistence.                          |

## 14.2 Recommended detection pipeline

```text
1. Read OS/PTY facts: isatty, window size, platform, locale.
2. Read environment: TERM, COLORTERM, TERM_PROGRAM, multiplexer variables.
3. Load terminfo entry if available.
4. Apply multiplexer profile: tmux/screen/zellij/SSH/ConPTY.
5. Send safe probes if interactive and input parser is active.
6. Merge results into a capability object with confidence levels.
7. Allow user/app overrides.
8. Cache only when environment identity is stable.
```

## 14.3 Query response routing

Terminal responses arrive on stdin and can look like input. Maintain a query registry:

```text
pending query id -> expected regex/parser predicate -> deadline -> callback
```

Do not let CPR (`CSI row;col R`) become `Alt+[`, `R`, or random key events.

## 14.4 Confidence levels

A capability should record confidence:

| Confidence    | Meaning                                    |
| ------------- | ------------------------------------------ |
| `assumed`     | Default assumption based on broad support. |
| `terminfo`    | From terminfo.                             |
| `environment` | From env var heuristic.                    |
| `probed`      | Confirmed by response.                     |
| `configured`  | User override.                             |
| `disabled`    | Explicitly disabled by policy/security.    |

---

# 15. terminfo, termcap, curses, and capability databases

## 15.1 termcap vs terminfo

- `termcap` is older, string-oriented, and limited.
- `terminfo` is compiled, structured, and used by curses/ncurses.

A terminfo entry contains:

- names/aliases;
- boolean capabilities;
- numeric capabilities;
- string capabilities;
- `use=` inheritance.

## 15.2 Common terminfo capabilities for TUIs

| Capability                                             | Meaning                                     |
| ------------------------------------------------------ | ------------------------------------------- |
| `cup`                                                  | Cursor position.                            |
| `clear`                                                | Clear screen.                               |
| `el`, `ed`                                             | Clear line/display portions.                |
| `smcup`, `rmcup`                                       | Enter/exit alternate screen.                |
| `civis`, `cnorm`, `cvvis`                              | Cursor invisible/normal/very visible.       |
| `setaf`, `setab`                                       | Set ANSI foreground/background.             |
| `setrgbf`, `setrgbb`                                   | RGB colors in newer/extended entries.       |
| `sgr`, `sgr0`                                          | Set/reset attributes.                       |
| `sitm`, `ritm`                                         | Italic on/off.                              |
| `smul`, `rmul`                                         | Underline on/off.                           |
| `blink`, `bold`, `dim`, `rev`, `invis`, `smso`, `rmso` | Attributes.                                 |
| `kf1`..`kf63`                                          | Function key input sequences.               |
| `kcuu1`, `kcud1`, `kcuf1`, `kcub1`                     | Arrow input sequences.                      |
| `kmous`                                                | Mouse input introducer.                     |
| `XM`                                                   | Mouse mode string in some extended entries. |
| `Ms`                                                   | OSC 52 clipboard in some extended entries.  |
| `Smulx`                                                | Extended underline style in some entries.   |
| `Setulc`                                               | Underline color in some entries.            |

## 15.3 terminfo parameter language

String capabilities may contain a stack language:

```text
%p1%d        print parameter 1 as decimal
%p1%{1}%+%d  add 1 to parameter 1
%i           increment first two parameters
%? %t %e %;  conditionals
```

A framework that consumes terminfo directly must implement this language or use a library.

## 15.4 Extended capabilities

Ncurses supports user-defined/extended capabilities, often accessed with `infocmp -x` and compiled with `tic -x`.

Common extensions:

| Capability  | Meaning                                          |
| ----------- | ------------------------------------------------ |
| `Tc`        | Historical flag used to advertise truecolor.     |
| `RGB`       | More modern truecolor capability marker.         |
| `Ms`        | OSC 52 clipboard set.                            |
| `Se` / `Ss` | Cursor style reset/set in some entries.          |
| `Smulx`     | Underline style.                                 |
| `Setulc`    | Underline color.                                 |
| `U8`        | Unicode/UTF-8 related marker in some ecosystems. |

Do not assume every system terminfo database is current.

## 15.5 Limitations of terminfo

terminfo usually does not fully describe:

- Kitty keyboard protocol;
- Kitty graphics;
- iTerm2 inline images;
- OSC 8 hyperlinks;
- OSC 133 shell integration;
- focus events;
- bracketed paste in all entries;
- synchronized output;
- exact Unicode width behavior;
- security policies;
- multiplexer filtering.

Therefore a modern TUI needs both terminfo and active/heuristic feature negotiation.

## 15.6 curses and ncurses

Curses provides:

- window abstraction;
- screen diffing;
- keyboard decoding;
- color pairs;
- terminfo access;
- mouse support in ncurses.

Limitations for next-generation TUIs:

- color-pair model can be restrictive;
- Unicode grapheme support varies by binding;
- modern graphics protocols are out of scope;
- enhanced keyboard protocols are not consistently exposed;
- async/event-loop integration may be awkward.

---

# 16. Keyboard input protocols

## 16.1 Legacy ASCII controls

Control keys historically map letters to C0 controls:

| Key      |                             Byte |
| -------- | -------------------------------: |
| `Ctrl+A` |                           `0x01` |
| `Ctrl+B` |                           `0x02` |
| `Ctrl+C` | `0x03` or signal if ISIG enabled |
| `Ctrl+H` |                           `0x08` |
| `Ctrl+I` |                     `0x09` = Tab |
| `Ctrl+J` |                      `0x0A` = LF |
| `Ctrl+M` |                `0x0D` = CR/Enter |
| `Ctrl+[` |                  `0x1B` = Escape |
| `Ctrl+?` |                     `0x7F` = DEL |

Ambiguities:

- `Tab` vs `Ctrl+I`;
- `Enter` vs `Ctrl+M`;
- `Escape` vs `Ctrl+[`;
- `Backspace` may be `BS` or `DEL`;
- `Ctrl+Space` may be NUL or unsupported;
- `Ctrl+Shift+letter` often collapses to `Ctrl+letter`.

## 16.2 Printable text input

Printable keys usually produce encoded text according to locale/UTF-8. Keyboard layout and IME composition happen in the terminal emulator/OS before bytes reach the application.

A TUI must distinguish:

- text insertion events;
- physical key events;
- shortcut events;
- composed input.

Legacy protocols cannot fully provide physical key identity.

## 16.3 Alt / Meta

Legacy convention:

```text
Alt+x -> ESC x
```

This collides with:

```text
Escape, then x
```

Applications use a timeout after ESC to distinguish lone Escape from an Alt-prefixed sequence. Enhanced keyboard protocols eliminate or reduce this ambiguity.

## 16.4 Function keys and arrows

Common legacy sequences:

| Key       | Common normal sequence                                       |
| --------- | ------------------------------------------------------------ |
| Up        | `ESC [ A`                                                    |
| Down      | `ESC [ B`                                                    |
| Right     | `ESC [ C`                                                    |
| Left      | `ESC [ D`                                                    |
| Home      | `ESC [ H` or `ESC [ 1 ~`                                     |
| End       | `ESC [ F` or `ESC [ 4 ~`                                     |
| Insert    | `ESC [ 2 ~`                                                  |
| Delete    | `ESC [ 3 ~`                                                  |
| Page Up   | `ESC [ 5 ~`                                                  |
| Page Down | `ESC [ 6 ~`                                                  |
| F1–F4     | `ESC O P`..`ESC O S` or `ESC [ 11~`..                        |
| F5–F12    | `ESC [ 15~`, `17~`, `18~`, `19~`, `20~`, `21~`, `23~`, `24~` |

## 16.5 Modified special keys: xterm convention

xterm commonly encodes modifiers as parameter `1;M` or similar:

```text
Shift+Up     CSI 1 ; 2 A
Alt+Up       CSI 1 ; 3 A
Ctrl+Up      CSI 1 ; 5 A
Ctrl+Shift+Up CSI 1 ; 6 A
```

Modifier encoding is often:

```text
encoded_modifier = 1 + bitmask
Shift = 1
Alt   = 2
Ctrl  = 4
```

So `Ctrl` alone is `1+4 = 5`.

For tilde keys:

```text
Ctrl+Delete -> CSI 3 ; 5 ~
```

This is widely useful but not universal.

## 16.6 Application cursor and keypad modes

The same physical key may send different sequences depending terminal mode:

- normal cursor mode: `CSI A`;
- application cursor mode: `SS3 A`;
- numeric keypad mode: printable digits;
- application keypad mode: SS3 keypad sequences.

A TUI should either:

- set the modes it expects; or
- accept both forms in the input parser.

## 16.7 Backspace and Delete

Backspace may send:

- `0x08` (`BS`, `Ctrl+H`);
- `0x7F` (`DEL`);
- `CSI 3 ~` for Delete.

Terminal settings, `stty erase`, DECBKM, and emulator preferences affect this. Normalize semantically but allow configuration.

## 16.8 `modifyOtherKeys`

xterm `modifyOtherKeys` improves reporting for modified printable keys. It has multiple versions/modes and is not uniformly implemented.

Typical encoded forms include:

```text
CSI 27 ; modifier ; codepoint ~
CSI codepoint ; modifier u
```

Limitations:

- not all terminals implement it;
- behavior differs by mode/version;
- does not represent every modern keyboard concept;
- can interact poorly with applications expecting legacy input.

## 16.9 CSI-u / “fixterms” style keyboard encoding

CSI-u encodes modified keys in forms such as:

```text
CSI codepoint ; modifier u
```

It solves many control-key ambiguities but has competing variants. A parser should recognize it as a family and normalize based on negotiated mode/profile.

## 16.10 Kitty keyboard protocol

Kitty keyboard protocol is the most systematic modern keyboard protocol. It uses progressive enhancement flags and stack-based mode management.

### 16.10.1 Flags

| Flag                            | Bit | Meaning                                          |
| ------------------------------- | --: | ------------------------------------------------ |
| Disambiguate escape codes       |   1 | Encode ambiguous keys distinctly.                |
| Report event types              |   2 | Press/repeat/release events.                     |
| Report alternate keys           |   4 | Include shifted/alternate key identities.        |
| Report all keys as escape codes |   8 | Printable keys also encoded as escape sequences. |
| Report associated text          |  16 | Include text generated by key event.             |

### 16.10.2 Query and mode setting

```text
CSI ? u       query current flags
CSI ? flags u response
CSI > flags u set flags
CSI = flags u push flags?
CSI < u       pop flags?   // exact push/pop forms depend on spec revision; implement from official spec.
```

The important implementation principle: use official spec grammar, do not invent textual commands such as `kitty +flag` on the wire.

### 16.10.3 Event model

Kitty events can represent:

- key press;
- repeat;
- release;
- modifiers;
- physical/non-shifted key;
- alternate key;
- associated Unicode text.

### 16.10.4 Why it matters

It distinguishes cases legacy terminals cannot:

- `Escape` vs `Ctrl+[`;
- `Tab` vs `Ctrl+I`;
- `Enter` vs `Ctrl+M`;
- `Alt+x` vs `Escape` then `x`;
- shifted function keys;
- key release events;
- keyboard layout text vs physical key.

## 16.11 Keyboard protocol strategy for a framework

Recommended order:

1. Always support legacy input.
2. Accept xterm modified special keys.
3. Accept CSI-u/fixterms forms.
4. Probe and enable Kitty keyboard when safe and supported.
5. Preserve raw input for unknown sequences in debug mode.
6. Normalize to semantic events:

```text
KeyEvent {
  key: Key,
  physical_key?: PhysicalKey,
  text?: string,
  modifiers: Modifiers,
  event_type: press | repeat | release,
  source_protocol: legacy | xterm | csi_u | kitty,
  raw: bytes
}
```

## 16.12 IME and compose handling

Terminal applications usually receive committed text, not composition state. Do not assume every text input corresponds to a keypress. A framework should route committed text through text-input widgets and shortcut keys through key-event logic.

---

# 17. Mouse, pointer, focus, paste, and window events

## 17.1 Mouse protocol families

| Mode | Enable         | Name                      | Notes                                 |
| ---: | -------------- | ------------------------- | ------------------------------------- |
|    9 | `CSI ? 9 h`    | X10                       | Press only, old format.               |
| 1000 | `CSI ? 1000 h` | X11/VT200 normal tracking | Press/release.                        |
| 1002 | `CSI ? 1002 h` | Button-event tracking     | Press/release/drag.                   |
| 1003 | `CSI ? 1003 h` | Any-event tracking        | All motion; high volume.              |
| 1004 | `CSI ? 1004 h` | Focus events              | Focus in/out.                         |
| 1005 | `CSI ? 1005 h` | UTF-8 mouse               | Obsolete/problematic.                 |
| 1006 | `CSI ? 1006 h` | SGR mouse                 | Recommended cell-coordinate protocol. |
| 1015 | `CSI ? 1015 h` | urxvt mouse               | Legacy extension.                     |
| 1016 | `CSI ? 1016 h` | SGR pixel mouse           | Pixel coordinates.                    |

## 17.2 X10 / legacy mouse encoding

Old format:

```text
CSI M Cb Cx Cy
```

where `Cb`, `Cx`, `Cy` are single bytes offset by 32. This is byte-oriented, limited, and awkward with UTF-8.

## 17.3 SGR mouse

Format:

```text
CSI < Cb ; Cx ; Cy M   press/drag/wheel/motion
CSI < Cb ; Cx ; Cy m   release
```

Coordinates are 1-based cell coordinates unless pixel mode is active.

Common base button codes:

| Cb | Meaning                                    |
| -: | ------------------------------------------ |
|  0 | Left press.                                |
|  1 | Middle press.                              |
|  2 | Right press.                               |
|  3 | Release/no button.                         |
| 32 | Left drag.                                 |
| 33 | Middle drag.                               |
| 34 | Right drag.                                |
| 35 | Release/motion variant depending protocol. |
| 64 | Wheel up.                                  |
| 65 | Wheel down.                                |
| 66 | Wheel left or button depending terminal.   |
| 67 | Wheel right or button depending terminal.  |
| 96 | Motion with no button in any-event mode.   |

Modifier bits in xterm-style mouse encoding:

| Bit value | Modifier |
| --------: | -------- |
|         4 | Shift    |
|         8 | Meta/Alt |
|        16 | Ctrl     |

Important correction: do not confuse mouse modifier bits with Kitty keyboard modifier bits.

## 17.4 Mouse event normalization

```text
MouseEvent {
  kind: press | release | drag | move | wheel,
  button: left | middle | right | wheel_up | wheel_down | wheel_left | wheel_right | extra(n),
  x: int, y: int,
  coordinate_space: cells | pixels,
  modifiers: shift/alt/ctrl,
  raw: bytes,
  protocol: x10 | normal | sgr | urxvt | pixel
}
```

## 17.5 DEC Locator

DEC Locator is a historical pointer-event facility separate from xterm mouse tracking. It includes locator enable/report controls and can report button events and coordinates. Support in modern emulators is limited. Treat as historical unless targeting specific DEC-compatible environments.

Related controls include locator enable/request/report sequences in DEC manuals; do not confuse them with xterm mouse modes.

## 17.6 Highlight tracking

xterm highlight tracking allows applications to define a region and receive reports related to selecting/highlighting. It is rarely used by modern TUIs and may be unsupported.

## 17.7 Focus events

Enable:

```text
CSI ? 1004 h
```

Events:

| Event     | Sequence |
| --------- | -------- |
| Focus in  | `CSI I`  |
| Focus out | `CSI O`  |

Use cases:

- refresh on focus;
- pause animations;
- sync clipboard;
- update active-pane style.

## 17.8 Bracketed paste

Enable:

```text
CSI ? 2004 h
```

Delimiters:

```text
CSI 200 ~   paste start
CSI 201 ~   paste end
```

Rules:

- Treat pasted content as data, not as key shortcuts.
- Do not execute pasted newlines as commands unless the widget explicitly chooses to.
- Preserve exact bytes/text as much as possible.
- Sanitize or quote pasted control sequences in text fields.

## 17.9 Alternate scroll mode

Enable:

```text
CSI ? 1007 h
```

When enabled in some environments, wheel events may be translated to cursor up/down in alternate screen applications. Modern TUIs usually prefer SGR mouse wheel events.

## 17.10 Pointer shapes

Some terminals support pointer-shape changes through proprietary protocols. Treat as optional progressive enhancement:

- text/I-beam over text fields;
- pointer hand over links/buttons;
- resize cursors for splitters.

Never require pointer-shape support for functionality.

---

# 18. Image and graphics protocols

Terminal graphics are not one protocol. They are a family of historical and modern mechanisms.

## 18.1 Text pseudo-graphics

Most portable approach:

| Technique      | Characters                             | Use                                    |
| -------------- | -------------------------------------- | -------------------------------------- |
| Box drawing    | `─│┌┐└┘├┤┬┴┼`                          | Borders, tables.                       |
| Block elements | `█▓▒░▀▄▌▐`                             | Bars, crude images.                    |
| Braille        | `⠁`..`⣿`                               | High-density plots: 2×4 dots per cell. |
| Quadrants      | `▖▗▘▙▚▛▜▝▞▟`                           | 2×2 pixel-ish rendering.               |
| Sextants       | Unicode sextant blocks where supported | Higher-density graphics.               |
| Half blocks    | `▀▄` with foreground/background        | Two vertical pixels per cell.          |

Advantages:

- works over SSH/tmux/logs;
- selectable text;
- no payload security problem;
- themable.

Limitations:

- font-dependent;
- not true raster;
- color blending limited.

## 18.2 Sixel

Sixel is a DEC bitmap graphics format using DCS. It represents vertical runs of six pixels using printable ASCII characters.

Basic shape:

```text
DCS Pq ; Pu ; Ph q sixel-data ST
```

Common elements:

| Token                   | Meaning                                        |
| ----------------------- | ---------------------------------------------- |
| `q` final               | Enters Sixel data mode.                        |
| `?`..`~`                | Sixel characters encoding six vertical pixels. |
| `! n char`              | Repeat introducer; repeat char n times.        |
| `# n`                   | Select color register n.                       |
| `# n ; mode ; ...`      | Define color register.                         |
| `" pan ; pad ; ph ; pv` | Raster attributes.                             |
| `$`                     | Carriage return within sixel graphics.         |
| `-`                     | New line in sixel graphics.                    |

Color definition examples:

```text
#1;2;100;0;0     define color 1 in RGB-like percentages
#2;2;0;100;0     define color 2
```

Strengths:

- historical DEC lineage;
- supported by xterm when enabled/configured and many modern terminals;
- works as a byte stream;
- good for remote rendering.

Weaknesses:

- palette constraints;
- variable support;
- interaction with scrollback differs;
- no universal detection;
- payload size can be large.

## 18.3 ReGIS

ReGIS is DEC vector graphics language used by some DEC terminals. It is DCS/string based and can draw lines, curves, fills, and text. It is historically important but far less relevant for modern TUI frameworks than Sixel or Kitty graphics.

Use ReGIS only as an optional backend for specialized compatibility.

## 18.4 Tektronix 4014 mode

Some terminals/xterm emulate Tektronix vector graphics. It uses a different coordinate and drawing model. This is mostly historical and not recommended for a modern TUI, but terminal emulators may still expose it.

## 18.5 DRCS: Dynamically Redefinable Character Sets

DRCS lets applications define glyphs/characters dynamically, often using Sixel-like data. Historically used for soft fonts and custom symbols. Modern Unicode reduces the need, but DRCS matters for DEC completeness.

## 18.6 iTerm2 inline images

iTerm2 image protocol uses OSC 1337 `File=` payloads.

General form:

```text
OSC 1337 ; File = key=value ; key=value : base64-data ST
```

Common parameters:

| Parameter             | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `name`                | Base64 filename.                                           |
| `size`                | File size in bytes.                                        |
| `width`               | Width in cells, pixels, percent, or auto depending syntax. |
| `height`              | Height in cells, pixels, percent, or auto.                 |
| `preserveAspectRatio` | `1` or `0`.                                                |
| `inline`              | `1` to display inline.                                     |

Example shape:

```text
ESC ] 1337 ; File = inline=1;width=40;height=10;preserveAspectRatio=1 : BASE64 ESC \
```

It can also support file-transfer-like behavior over non-8-bit-clean transports.

## 18.7 Kitty graphics protocol

Kitty graphics uses APC:

```text
ESC _ G key=value,key=value;payload ESC \
```

Its goals include performant raster graphics, pixel positioning, text integration, alpha blending, scrolling with text, and efficient local transfer.

Major concepts:

| Concept             | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| action              | transmit, display, delete, query, animate depending `a=`.           |
| transmission medium | direct payload, file, temporary file, shared memory depending `t=`. |
| format              | RGB, RGBA, PNG and protocol-defined formats.                        |
| image id            | numeric id for reuse/deletion.                                      |
| placement id        | separate placement of transmitted image.                            |
| z-index             | layering relative to text.                                          |
| rows/columns        | cell-sized display placement.                                       |
| pixel offsets       | precise placement/cropping.                                         |
| chunks              | large payload split across multiple APC sequences.                  |
| responses           | terminal can report success/error.                                  |

A framework should implement Kitty graphics as a backend with:

- feature detection;
- chunking;
- id management;
- lifecycle cleanup;
- fallback to Sixel/iTerm2/Unicode;
- multiplexer passthrough awareness.

## 18.8 WezTerm and other graphics support

WezTerm supports multiple graphics-related protocols depending version/configuration, including Sixel and Kitty-style behavior. Always verify with documentation/probes because support evolves.

## 18.9 Image protocol selection

Recommended image backend order:

```text
1. Kitty graphics if positively supported and not blocked by multiplexer.
2. Sixel if supported and adequate for the image.
3. iTerm2 OSC 1337 if on iTerm2-compatible environment.
4. Unicode half-block/braille rendering.
5. External viewer or textual placeholder.
```

## 18.10 Image security

Image protocols can transfer large binary payloads, reference local files, or affect terminal resources. A framework must:

- limit payload size;
- avoid sending untrusted file paths;
- clean up image ids;
- sanitize image escape sequences in untrusted text;
- disable image protocols in logs, transcripts, and remote untrusted contexts unless explicitly enabled.

---

# 19. OSC protocols: title, hyperlinks, clipboard, shell integration, notifications

OSC sequences are vendor-heavy and security-sensitive.

## 19.1 Window and icon titles

| OSC                | Meaning                         |
| ------------------ | ------------------------------- |
| `OSC 0 ; title ST` | Set icon name and window title. |
| `OSC 1 ; title ST` | Set icon name.                  |
| `OSC 2 ; title ST` | Set window title.               |

Security concern: remote programs can spoof window titles.

## 19.2 Current working directory: OSC 7

Common form:

```text
OSC 7 ; file://host/path ST
```

Used by terminals for tabs, split panes, shell integration, and spawning new sessions in same directory.

## 19.3 Hyperlinks: OSC 8

Form:

```text
OSC 8 ; params ; URI ST
visible text
OSC 8 ; ; ST
```

Parameters may include `id=...` to connect multi-line links.

Security concerns:

- link text may not reveal URI;
- malicious logs can include hidden links;
- sanitize untrusted output or render links explicitly.

## 19.4 Clipboard: OSC 52

Form:

```text
OSC 52 ; Pc ; base64-data ST
```

`Pc` selects clipboard/selection targets, commonly:

| Pc    | Meaning                    |
| ----- | -------------------------- |
| `c`   | Clipboard.                 |
| `p`   | Primary selection.         |
| `s`   | Select.                    |
| empty | Terminal-specific default. |

Security concerns:

- remote hosts can write clipboard;
- clipboard reads, where supported, are highly sensitive;
- many terminals gate or disable OSC 52;
- tmux may intercept or forward depending options.

## 19.5 Palette and dynamic colors

| OSC | Meaning                    |
| --- | -------------------------- |
| 4   | Set/query palette entries. |
| 10  | Foreground color.          |
| 11  | Background color.          |
| 12  | Cursor color.              |
| 104 | Reset palette entries.     |
| 110 | Reset foreground.          |
| 111 | Reset background.          |
| 112 | Reset cursor color.        |

Frameworks generally should not globally mutate user palette without consent. Prefer SGR colors.

## 19.6 Shell integration: OSC 133

FinalTerm/modern shell integration marks shell prompt and command regions.

Common sequences:

| Sequence                    | Meaning                 |
| --------------------------- | ----------------------- |
| `OSC 133 ; A ST`            | Prompt start.           |
| `OSC 133 ; B ST`            | Prompt end.             |
| `OSC 133 ; C ST`            | Command/pre-exec start. |
| `OSC 133 ; D ; exitcode ST` | Command finished.       |

Useful for terminal scrollback navigation, command status, and shell-aware UI. A TUI usually consumes this only if embedding a shell.

## 19.7 VS Code / OSC 633

VS Code terminal shell integration uses `OSC 633`-style sequences for prompt, command, current working directory, and properties. It is environment-specific and should be treated as a host integration protocol rather than a portable TUI primitive.

## 19.8 iTerm2 OSC 1337

iTerm2 uses `OSC 1337` for:

- inline images/file transfer;
- marks;
- variables;
- shell integration;
- proprietary state.

Do not use unless targeting iTerm2-compatible behavior or after detection.

## 19.9 Notifications

Notification OSCs vary:

| Protocol            | Example                     | Notes                                      |
| ------------------- | --------------------------- | ------------------------------------------ |
| iTerm2/macOS legacy | `OSC 9 ; message ST`        | Historically used by iTerm-like terminals. |
| Kitty notifications | `OSC 99 ; ... ST`           | Extensible notification protocol.          |
| rxvt/urxvt variants | `OSC 777 ; notify ; ... ST` | Seen in some ecosystems.                   |

Notifications are user-visible side effects. Gate behind explicit app/user permission.

## 19.10 Proprietary OSC handling policy

A framework should have:

```text
osc_policy = {
  allow_title: true/false,
  allow_hyperlinks: true/false,
  allow_clipboard_write: user-approved,
  allow_clipboard_read: normally false,
  allow_palette_mutation: false by default,
  allow_notifications: user-approved,
  max_payload_bytes: N,
}
```

---

# 20. DCS protocols: queries, Sixel, ReGIS, UDKs, termcap exchange

## 20.1 DCS grammar

```text
DCS params intermediates final data ST
```

Examples:

```text
DCS $ q m ST       DECRQSS request SGR status
DCS + q hex ST     XTGETTCAP request
DCS ... q data ST  Sixel, depending introducer
```

## 20.2 DECRQSS

Request status string. Example uses:

| Request        | Meaning                                               |
| -------------- | ----------------------------------------------------- |
| `DCS $ q m ST` | Request current SGR.                                  |
| `DCS $ q r ST` | Request scroll region.                                |
| `DCS $ q q ST` | Request cursor style or protection depending context. |

Responses encode valid/invalid and current value. Parsing requires DCS response handling.

## 20.3 XTGETTCAP / XTSETTCAP

xterm extension for querying or setting terminal capabilities using termcap/terminfo-style names.

General shapes:

```text
DCS + q hex-name ; hex-name ST   query
DCS + r ... ST                   response
```

Names are often hex-encoded. Useful for capabilities not reliably known from local terminfo.

## 20.4 DECUDK: User Defined Keys

DEC terminals allowed applications/users to define key strings. This is historical and security-sensitive. Modern applications should avoid redefining user keys unless implementing terminal emulation/configuration tools.

## 20.5 Sixel over DCS

Sixel data is a DCS payload. The parser must not attempt to parse CSI/OSC inside the sixel payload; treat it as data until ST with protocol-specific escape handling.

## 20.6 ReGIS over DCS

ReGIS also uses DCS-style string controls. Treat similarly to Sixel: large payload, distinct parser mode, optional backend.

---

# 21. Multiplexers, remoting, and nested terminals

## 21.1 tmux

tmux is both a terminal emulator to applications and a terminal application to the outer terminal. It transforms capabilities.

Issues:

- `$TERM` inside tmux is often `screen`, `tmux`, or `tmux-256color`;
- outer terminal may support more than tmux advertises;
- mouse, focus, RGB, clipboard, and graphics may require tmux options;
- passthrough is needed for some protocols;
- nested tmux sessions compound problems.

Relevant concepts:

| tmux concept         | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `terminal-overrides` | Override capabilities by terminal pattern.                   |
| `terminal-features`  | Declare modern features such as RGB/clipboard in newer tmux. |
| `set-clipboard`      | Control OSC 52 behavior.                                     |
| `allow-passthrough`  | Permit passthrough sequences for protocols like graphics.    |
| mouse option         | tmux pane mouse support and forwarding.                      |

## 21.2 GNU screen

screen is older and often less transparent for modern protocols. It may:

- alter function key sequences;
- limit colors depending entry;
- block OSC 52 or OSC 8;
- not forward focus/mouse/graphics as expected.

## 21.3 Zellij

Zellij is a modern multiplexer with its own plugin and UI model. Protocol passthrough support differs from tmux and should be feature-detected.

## 21.4 SSH

SSH transports bytes but remote `$TERM` and terminfo may not match the local emulator. Problems:

- remote terminfo missing local terminal entry;
- clipboard/image protocols can affect local machine from remote host;
- latency changes ESC disambiguation timeouts;
- mosh may not support all byte-stream assumptions.

## 21.5 Nested terminal identity

A capability should include chain information when possible:

```text
outer_terminal: kitty
multiplexer: tmux 3.5
remote: ssh
inner_TERM: tmux-256color
locale: en_US.UTF-8
```

Feature support is the intersection plus passthrough rules, not simply the outer terminal.

## 21.6 Passthrough wrappers

tmux passthrough commonly uses DCS wrappers. Exact syntax and policy depend on tmux version/configuration. A framework should centralize passthrough encoding and never let arbitrary untrusted payloads use passthrough.

---

# 22. Operating-system and platform terminals

## 22.1 Linux virtual console

The Linux console is not xterm. It supports a subset and some Linux-specific sequences. Limitations often include:

- no truecolor in traditional console;
- limited Unicode/rendering depending font;
- limited OSC support;
- different palette sequences;
- no GUI clipboard or images.

Target it as a low-tier backend.

## 22.2 BSD consoles

FreeBSD vt, NetBSD/OpenBSD consoles have their own support subsets. Use terminfo and conservative rendering.

## 22.3 macOS Terminal.app

Terminal.app supports many common xterm-like sequences but differs from iTerm2. Do not assume iTerm2 image or OSC 1337 support.

## 22.4 iTerm2

Supports many xterm-like features plus proprietary OSC 1337 protocols, inline images, shell integration, and rich UI integration.

## 22.5 Windows Console and ConPTY

Windows historically had a Console API rather than terminal escape semantics. Modern Windows supports Virtual Terminal Sequences when modes are enabled.

Important flags/concepts:

- `ENABLE_VIRTUAL_TERMINAL_PROCESSING` for output;
- `ENABLE_VIRTUAL_TERMINAL_INPUT` for input;
- ConPTY as PTY-like bridge;
- Windows Terminal as modern frontend;
- legacy conhost behavior differences.

A cross-platform framework should have a Windows backend that can:

- enable VT processing;
- fall back to Console APIs if necessary;
- normalize resize/input events;
- handle UTF-16/UTF-8 boundary issues;
- account for ConPTY bugs/limitations.

## 22.6 Web terminals

xterm.js is widely used in browser terminals. It implements a documented subset of VT sequences and can be extended by addons.

Constraints:

- browser clipboard permissions;
- font and canvas rendering differences;
- WebSocket latency;
- security sandbox;
- optional support for images/links/search depending host.

## 22.7 VS Code integrated terminal

Based on xterm.js with VS Code integrations. Supports many common sequences plus shell integration conventions. Environment may advertise `TERM_PROGRAM=vscode`.

## 22.8 JetBrains, IDE, and embedded terminals

Embedded terminals often lag behind standalone emulators. Treat them as xterm.js-like or custom profiles and avoid assuming graphics/clipboard support.

---

# 23. Terminal emulator families and compatibility notes

## 23.1 xterm

Reference implementation for many de facto protocols. Highly configurable; features such as Sixel may be compile-time or resource controlled.

## 23.2 Kitty

Modern GPU terminal with Kitty keyboard, graphics, shell integration, notifications, and many advanced protocols. Strong feature set but not all protocols are standard elsewhere.

## 23.3 WezTerm

Modern Rust terminal with rich documentation, Lua configuration, multiplexing features, Sixel/Kitty-related support, and explicit UTF-8 model.

## 23.4 iTerm2

macOS terminal with proprietary OSC 1337, inline images, shell integration, and extensive escape code support.

## 23.5 Alacritty

GPU terminal focused on performance and conservative feature set. Historically avoids some image protocols and shell integrations. Verify current support.

## 23.6 foot

Wayland terminal with strong standards-oriented support including Sixel in many configurations and modern protocol support.

## 23.7 Ghostty

Modern terminal with documented VT parser concepts and support for many modern protocols. Its exact feature matrix evolves quickly; use docs/probes.

## 23.8 mintty

Windows/Cygwin/MSYS terminal with rich xterm-like behavior, OSC support, and Windows integration.

## 23.9 Contour

Modern terminal with VT extensions documentation and shell integration support.

## 23.10 Rio, st, Terminology, mlterm, rxvt-unicode

Each has specific feature profiles:

- `st`: minimal, patch-driven;
- rxvt-unicode: urxvt mouse mode and OSC variants;
- mlterm: broad multilingual/legacy support;
- Terminology: image/media-oriented features;
- Rio: modern protocols including graphics depending version.

A framework should not ship one static table as truth. Ship a data-driven registry with versions and probes.

---

# 24. Security model for terminal protocols

## 24.1 Threat model

Untrusted bytes can come from:

- remote SSH commands;
- build logs;
- test output;
- chat/model output;
- package install scripts;
- file previews;
- compiler errors containing malicious filenames;
- pasted text;
- terminal query responses spoofed by application output.

## 24.2 Dangerous capabilities

| Capability                 | Risk                                                   |
| -------------------------- | ------------------------------------------------------ |
| OSC 52 clipboard           | Clipboard overwrite or read where supported.           |
| OSC 8 hyperlinks           | Phishing, hidden URI.                                  |
| OSC title                  | Spoofing terminal/window state.                        |
| OSC palette                | Visual deception.                                      |
| DCS/APC payloads           | Resource exhaustion, parser bugs, image/file payloads. |
| Query responses            | Input injection into application state.                |
| Bracketed paste delimiters | Confusing typed vs pasted input if spoofed in logs.    |
| Alternate screen           | Hiding output/history.                                 |
| Keyboard protocol changes  | Capturing `Ctrl+C` as key instead of signal.           |

## 24.3 Sanitization levels

| Level            | Behavior                                                  |
| ---------------- | --------------------------------------------------------- |
| Plain text       | Strip all controls except `\n`, `\t` maybe.               |
| Safe ANSI        | Allow SGR only, strip OSC/DCS/APC and cursor movement.    |
| TUI trusted      | Allow cursor/screen controls generated by framework only. |
| Full passthrough | Allow all; only for trusted terminal emulator sessions.   |

## 24.4 Logging policy

Never write raw untrusted terminal output to a log that may later be `cat`ed into a terminal. Encode controls visibly:

```text
ESC -> <ESC>
BEL -> <BEL>
CSI 31 m -> <CSI 31 m>
```

## 24.5 Query spoofing defense

When the framework sends a query, an untrusted process might print a fake response. Mitigations:

- only query while application controls the screen/input;
- use short deadlines;
- validate exact grammar;
- correlate with query timing;
- avoid high-risk queries in untrusted shells;
- separate shell subprocess output from terminal response parsing where possible.

## 24.6 Clipboard policy

Recommended defaults:

- allow copying to clipboard only when application explicitly requests and user config permits;
- never read clipboard through terminal protocols by default;
- display a warning or require opt-in for remote sessions;
- cap clipboard payload length.

## 24.7 Image and file policy

- Do not allow untrusted text to emit image/file protocols.
- Do not send local file paths to terminal unless trusted.
- Prefer direct payload over local file reference for privacy, unless performance requires local optimized path and user consents.
- Delete/expire image ids.

---

# 25. Architecture of a robust TUI framework

## 25.1 Core layers

```text
App widgets
  ↓
Declarative UI tree / state model
  ↓
Layout engine: constraints, flex/grid, scroll regions
  ↓
Renderer: virtual screen, damage tracking, protocol backend
  ↓
Terminal capability model
  ↓
Protocol emitter: ECMA/xterm/Kitty/iTerm2/Sixel/etc.
  ↓
Transport: stdout/pty/Windows console/websocket

Input bytes
  ↓
Byte parser: UTF-8 + control state machine
  ↓
Protocol decoders: keyboard/mouse/paste/queries
  ↓
Normalizer: semantic events
  ↓
Focus/router/widget event dispatch
```

## 25.2 Transport abstraction

```text
trait TerminalTransport {
  read(bytes) -> stream
  write(bytes)
  flush()
  size() -> {rows, cols, pixels?}
  set_raw_mode()
  restore()
  on_signal(SIGWINCH)
}
```

Backends:

- POSIX TTY;
- Windows VT/ConPTY;
- in-memory test terminal;
- PTY host;
- web terminal bridge.

## 25.3 Parser architecture

Separate parsers:

1. UTF-8 decoder;
2. ECMA-48 control parser;
3. string-control payload parser;
4. input protocol decoder;
5. terminal response correlator.

Do not parse terminal input with one regex.

## 25.4 Virtual screen model

A cell should contain:

```text
Cell {
  grapheme: string,
  width: 0|1|2,
  style: Style,
  hyperlink?: LinkId,
  image_overlay?: ImageRef,
  dirty: bool,
}
```

For wide graphemes, mark continuation cells.

## 25.5 Damage tracking

Track changed regions rather than repainting everything:

- cell dirty flags;
- line hashes;
- rectangular regions;
- scroll detection;
- cursor final position optimization.

Use synchronized output when available:

```text
CSI ? 2026 h
... frame output ...
CSI ? 2026 l
```

Fallback to buffered writes and minimal diffs.

## 25.6 Layout engine

Required primitives:

- fixed, percentage, min/max constraints;
- flex rows/columns;
- grid;
- overlays/popups;
- scroll views;
- z-order;
- clipping;
- focus scopes;
- mouse hit testing;
- grapheme-aware measurement.

## 25.7 Event model

```text
Event =
  Key(KeyEvent)
  TextInput(string)
  Mouse(MouseEvent)
  Paste(PasteEvent)
  FocusGained/FocusLost
  Resize(SizeEvent)
  Timer(TimerId)
  TerminalResponse(Response)
  AppMessage(Message)
```

Do not force all input into key events; paste and text composition should be distinct.

## 25.8 Capability object

A robust capability model includes:

```text
Capabilities {
  identity: TerminalIdentity,
  colors: ColorCaps,
  text: TextCaps,
  input: InputCaps,
  mouse: MouseCaps,
  screen: ScreenCaps,
  osc: OscCaps,
  graphics: GraphicsCaps,
  queries: QueryCaps,
  multiplexer: MultiplexerCaps,
  security: SecurityPolicy,
}
```

Each field should have confidence and source.

## 25.9 Renderer backends

| Backend       | Features                                        |
| ------------- | ----------------------------------------------- |
| Dumb          | Plain text only.                                |
| ANSI basic    | cursor, clear, 8 colors.                        |
| ECMA-48       | full classic TUI controls.                      |
| xterm modern  | mouse, paste, focus, 256/truecolor, OSC 8/52.   |
| Rich graphics | Kitty/Sixel/iTerm2 images.                      |
| Test backend  | Deterministic transcript and screen assertions. |

## 25.10 Widget system considerations

Widgets should be protocol-independent:

- Button does not know about SGR mouse; it receives MouseEvent.
- TextInput does not know about bracketed paste; it receives PasteEvent/TextInput.
- ImageView asks renderer for image capability and fallback.
- Link widget asks renderer for OSC 8 or visual fallback.

## 25.11 Accessibility

Terminal accessibility is limited but a framework can help:

- semantic mode for screen readers;
- plain text fallback;
- no color-only distinctions;
- high contrast themes;
- keyboard navigation;
- focus indicators;
- optional sound/bell control;
- avoid excessive animations.

## 25.12 Internationalization

- grapheme-aware cursoring;
- width policy configuration;
- RTL caveats;
- IME-friendly text input;
- locale-aware key bindings if desired;
- do not split combining sequences.

---

# 26. Recommended support tiers

## 26.1 Tier 0 — Dumb/pipe-safe

- no cursor addressing;
- no colors required;
- readable logs;
- no raw mode required.

## 26.2 Tier 1 — Classic ANSI/VT100

- cursor movement;
- clear screen/line;
- basic SGR;
- alternate screen optional;
- legacy keyboard.

## 26.3 Tier 2 — xterm-compatible modern TUI

- 256 colors;
- truecolor if detected;
- SGR mouse;
- bracketed paste;
- focus events;
- alternate screen;
- OSC 8 optional;
- OSC 52 optional;
- synchronized output optional;
- robust terminfo fallback.

## 26.4 Tier 3 — Enhanced input

- Kitty keyboard protocol or CSI-u;
- distinguish ambiguous keys;
- key release/repeat where available;
- associated text events;
- configurable shortcut engine.

## 26.5 Tier 4 — Rich media

- Kitty graphics;
- Sixel;
- iTerm2 images;
- pixel mouse;
- image lifecycle management;
- fallback rendering.

## 26.6 Tier 5 — Experimental/host integrations

- shell integration;
- notifications;
- drag and drop;
- file transfer;
- pointer shape;
- terminal-specific APIs.

---

# 27. Implementation checklists

## 27.1 Minimum production TUI checklist

- [ ] Enter and restore raw/cbreak mode safely.
- [ ] Handle SIGWINCH / resize.
- [ ] Use alternate screen optionally and restore it.
- [ ] Hide/show cursor safely.
- [ ] Reset SGR on exit.
- [ ] Parse UTF-8 incrementally.
- [ ] Parse ESC/CSI/OSC/DCS incrementally.
- [ ] Decode legacy keyboard and xterm special keys.
- [ ] Support bracketed paste.
- [ ] Support SGR mouse optionally.
- [ ] Load terminfo or have conservative fallbacks.
- [ ] Use grapheme-aware width.
- [ ] Sanitize untrusted output.
- [ ] Have golden transcript tests.

## 27.2 Advanced framework checklist

- [ ] Capability confidence model.
- [ ] Kitty keyboard support with push/pop restoration.
- [ ] Query manager for DA/DSR/DECRQM/XTGETTCAP.
- [ ] Synchronized output support.
- [ ] OSC 8 hyperlinks with fallback.
- [ ] OSC 52 with security policy.
- [ ] Kitty graphics backend.
- [ ] Sixel backend.
- [ ] iTerm2 image backend.
- [ ] tmux passthrough abstraction.
- [ ] Windows VT backend.
- [ ] xterm.js/web backend.
- [ ] Fuzzed parser.
- [ ] Terminal compatibility test matrix.

## 27.3 Exit cleanup sequence template

```text
CSI ? 2026 l    end synchronized output, if active
CSI ? 1003 l    disable any-event mouse
CSI ? 1002 l    disable button-event mouse
CSI ? 1000 l    disable normal mouse
CSI ? 1006 l    disable SGR mouse
CSI ? 1016 l    disable pixel mouse
CSI ? 1004 l    disable focus events
CSI ? 2004 l    disable bracketed paste
CSI ? 25 h      show cursor
CSI 0 m         reset SGR
CSI ? 1049 l    exit alternate screen, if entered
restore termios
```

Track exactly what you enabled and restore only those modes where possible.

---

# Appendix A — Sequence catalog

## A.1 Common output sequences

| Purpose                   | Sequence                  |
| ------------------------- | ------------------------- |
| Reset attributes          | `CSI 0 m`                 |
| Clear screen              | `CSI 2 J`                 |
| Clear scrollback          | `CSI 3 J`                 |
| Move cursor               | `CSI row ; col H`         |
| Hide cursor               | `CSI ? 25 l`              |
| Show cursor               | `CSI ? 25 h`              |
| Enter alternate screen    | `CSI ? 1049 h`            |
| Exit alternate screen     | `CSI ? 1049 l`            |
| Enable bracketed paste    | `CSI ? 2004 h`            |
| Disable bracketed paste   | `CSI ? 2004 l`            |
| Enable SGR mouse          | `CSI ? 1006 h`            |
| Enable mouse drag         | `CSI ? 1002 h`            |
| Enable all mouse motion   | `CSI ? 1003 h`            |
| Enable focus events       | `CSI ? 1004 h`            |
| Begin synchronized output | `CSI ? 2026 h`            |
| End synchronized output   | `CSI ? 2026 l`            |
| Set title                 | `OSC 2 ; title ST`        |
| Hyperlink start           | `OSC 8 ; params ; uri ST` |
| Hyperlink end             | `OSC 8 ; ; ST`            |

## A.2 Common input sequences

| Input                    | Sequence               |
| ------------------------ | ---------------------- |
| Up                       | `CSI A`                |
| Down                     | `CSI B`                |
| Right                    | `CSI C`                |
| Left                     | `CSI D`                |
| Focus in                 | `CSI I`                |
| Focus out                | `CSI O`                |
| Paste start              | `CSI 200 ~`            |
| Paste end                | `CSI 201 ~`            |
| SGR mouse press          | `CSI < Cb ; Cx ; Cy M` |
| SGR mouse release        | `CSI < Cb ; Cx ; Cy m` |
| Cursor position response | `CSI row ; col R`      |

## A.3 Common SGR

| Purpose          | Sequence                   |
| ---------------- | -------------------------- |
| Bold             | `CSI 1 m`                  |
| Dim              | `CSI 2 m`                  |
| Italic           | `CSI 3 m`                  |
| Underline        | `CSI 4 m`                  |
| Reverse          | `CSI 7 m`                  |
| Strike           | `CSI 9 m`                  |
| Foreground RGB   | `CSI 38 ; 2 ; r ; g ; b m` |
| Background RGB   | `CSI 48 ; 2 ; r ; g ; b m` |
| Foreground 256   | `CSI 38 ; 5 ; n m`         |
| Background 256   | `CSI 48 ; 5 ; n m`         |
| Reset foreground | `CSI 39 m`                 |
| Reset background | `CSI 49 m`                 |

---

# Appendix B — Capability model schema

Example JSON-like schema:

```json
{
  "identity": {
    "term": "xterm-256color",
    "program": "kitty",
    "version": "unknown",
    "multiplexer": "tmux",
    "transport": "ssh",
    "platform": "posix"
  },
  "screen": {
    "alternate_screen": { "value": true, "source": "terminfo" },
    "synchronized_output": { "value": true, "source": "probe" },
    "cursor_shape": { "value": true, "source": "terminfo-extension" }
  },
  "colors": {
    "ansi_16": true,
    "palette_256": true,
    "truecolor": { "value": true, "source": "env+terminfo" },
    "underline_color": { "value": false, "source": "default" }
  },
  "input": {
    "legacy": true,
    "xterm_modified_keys": true,
    "kitty_keyboard": { "value": false, "source": "not-probed" },
    "bracketed_paste": true
  },
  "mouse": {
    "sgr": true,
    "pixel": false,
    "focus_events": true
  },
  "osc": {
    "hyperlinks": { "value": true, "policy": "allow" },
    "clipboard": { "value": true, "policy": "ask" },
    "title": { "value": true, "policy": "allow" }
  },
  "graphics": {
    "unicode_blocks": true,
    "sixel": { "value": false, "source": "not-probed" },
    "kitty": { "value": false, "source": "not-probed" },
    "iterm2": { "value": false, "source": "env" }
  }
}
```

---

# Appendix C — Parser state machine model

A practical parser can be based on these states:

```text
Ground
Escape
EscapeIntermediate
CSIEntry
CSIParam
CSIIntermediate
CSIIgnore
OSCString
DCSString
APCString
PMString
SOSString
UTF8Collect
```

## C.1 Ground state

- printable bytes go to UTF-8 decoder/text collector;
- C0 controls execute immediately;
- ESC enters Escape;
- 8-bit C1 controls enter corresponding state if supported.

## C.2 Escape state

- `[` -> CSIEntry;
- `]` -> OSCString;
- `P` -> DCSString setup;
- `_` -> APCString;
- `^` -> PMString;
- `X` -> SOSString;
- Fe final executes single escape control;
- charset designation enters charset handler.

## C.3 CSI states

Collect parameter and intermediate bytes until final byte. Dispatch based on:

```text
private_prefix + params + intermediates + final
```

Keep raw bytes for unknown sequences.

## C.4 String states

Collect until:

- BEL for OSC if allowed;
- ST for OSC/DCS/APC/PM/SOS;
- maximum length exceeded;
- timeout/cancel policy triggers.

Inside DCS/APC payloads, do not treat CSI-like bytes as terminal controls unless the protocol defines escaping.

## C.5 UTF-8 decoder

Incremental decoder must handle:

- split multi-byte sequences;
- invalid byte sequences;
- C0/ESC interruption;
- replacement policy;
- grapheme segmentation after decoding.

---

# Appendix D — Test strategy

## D.1 Golden parser tests

Feed byte chunks with arbitrary splits:

```text
ESC [ 31 m
ESC split across chunks
OSC title BEL
OSC title ESC \
DCS sixel payload ST
malformed CSI CAN
UTF-8 character split across reads
SGR mouse split across reads
```

Expected output: exact token stream.

## D.2 Terminal transcript tests

Record emitted bytes for rendering operations and compare to golden transcripts.

## D.3 Virtual terminal tests

Implement a minimal terminal emulator model for:

- cursor movement;
- SGR;
- erasing;
- wrapping;
- wide characters;
- scroll regions.

Assert final screen state.

## D.4 Real terminal matrix

Test manually or with harness against:

- xterm;
- Kitty;
- WezTerm;
- iTerm2;
- Alacritty;
- foot;
- Ghostty;
- Windows Terminal;
- Linux console;
- tmux;
- screen;
- xterm.js/VS Code.

## D.5 Fuzzing

Fuzz:

- parser byte stream;
- OSC/DCS payload lengths;
- invalid UTF-8;
- random C0 inside sequences;
- nested/incomplete strings;
- terminal query spoofing.

Security requirement: no panic, no unbounded memory growth, no stuck parser state.

---

# Glossary

| Term                 | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| ANSI escape sequence | Informal name for ECMA-48/ANSI-style terminal controls.             |
| APC                  | Application Program Command, string control introduced by `ESC _`.  |
| C0                   | 7-bit control character range `0x00..0x1F` plus DEL.                |
| C1                   | 8-bit control range `0x80..0x9F` or 7-bit ESC-prefixed equivalents. |
| CSI                  | Control Sequence Introducer, `ESC [` or `0x9B`.                     |
| DCS                  | Device Control String, `ESC P` or `0x90`.                           |
| DECSET               | DEC private mode set, `CSI ? Ps h`.                                 |
| DECRST               | DEC private mode reset, `CSI ? Ps l`.                               |
| ECMA-48              | Formal standard defining terminal control functions.                |
| Grapheme cluster     | User-perceived character, possibly multiple Unicode code points.    |
| OSC                  | Operating System Command, `ESC ]`.                                  |
| PTY                  | Pseudo-terminal.                                                    |
| SGR                  | Select Graphic Rendition, `CSI ... m`.                              |
| Sixel                | DEC raster graphics protocol using DCS.                             |
| ST                   | String Terminator, `ESC \` or C1 `0x9C`.                            |
| TTY                  | Teletype/terminal device abstraction.                               |
| xterm                | Terminal emulator and de facto reference for many extensions.       |

---

# References

## Formal and foundational standards

- ECMA-48: Control Functions for Coded Character Sets — https://ecma-international.org/publications-and-standards/standards/ecma-48/
- ECMA-35: Character Code Structure and Extension Techniques — https://ecma-international.org/
- ECMA-43: 8-bit Coded Character Set Structure and Rules — https://ecma-international.org/
- POSIX termios / Linux man page — https://man7.org/linux/man-pages/man3/termios.3.html
- Unicode Standard — https://www.unicode.org/
- Unicode Standard Annex #11: East Asian Width — https://www.unicode.org/reports/tr11/
- Unicode Standard Annex #29: Text Segmentation — https://www.unicode.org/reports/tr29/

## DEC and historical terminal references

- VT100.net DEC manuals — https://vt100.net/
- VT220 Programmer Reference Manual — https://vt100.net/docs/vt220-rm/

## xterm and de facto standards

- xterm Control Sequences — https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
- xterm Control Sequences PDF — https://invisible-island.net/xterm/ctlseqs/ctlseqs.pdf
- ncurses terminfo manual — https://man7.org/linux/man-pages/man5/terminfo.5.html
- ncurses terminfo source — https://invisible-island.net/ncurses/terminfo.src.html

## Modern terminal protocol references

- Terminfo.dev standards and feature database — https://terminfo.dev/standards
- Kitty keyboard protocol — https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- Kitty graphics protocol — https://sw.kovidgoyal.net/kitty/graphics-protocol/
- Kitty desktop notifications — https://sw.kovidgoyal.net/kitty/desktop-notifications/
- iTerm2 proprietary escape codes — https://iterm2.com/documentation-escape-codes.html
- iTerm2 inline images — https://iterm2.com/documentation-images.html
- WezTerm escape sequences — https://wezterm.org/escape-sequences.html
- WezTerm shell integration — https://wezterm.org/shell-integration.html
- Ghostty VT sequence concepts — https://ghostty.org/docs/vt/concepts/sequences
- xterm.js supported terminal sequences — https://xtermjs.org/docs/api/vtfeatures/
- Contour OSC 133 shell integration — https://contour-terminal.org/vt-extensions/osc-133-shell-integration/
- VS Code terminal shell integration — https://code.visualstudio.com/docs/terminal/shell-integration
- Microsoft Console Virtual Terminal Sequences — https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences
- Microsoft Classic Console APIs vs VT sequences — https://learn.microsoft.com/en-us/windows/console/classic-vs-vt

## Graphics references

- Kitty graphics protocol — https://sw.kovidgoyal.net/kitty/graphics-protocol/
- iTerm2 inline images — https://iterm2.com/documentation-images.html
- Sixel overview / terminal support resources — https://www.arewesixelyet.com/
- xterm Sixel/ReGIS controls — https://invisible-island.net/xterm/ctlseqs/ctlseqs.html

---

# Closing engineering principle

A terminal framework should treat terminal protocols the way a browser treats the web platform: historical, inconsistent, security-sensitive, extensible, and impossible to reduce to a single static table. The right design is layered parsing, explicit capability negotiation, conservative fallbacks, aggressive testing, and strict separation between raw terminal bytes and semantic UI events.

---

# Appendix E — Expanded historical terminal families

This appendix is not required for most modern TUI frameworks, but it matters if the goal is an encyclopedic protocol map.

## E.1 ADM-3A

The Lear Siegler ADM-3A is historically important because its keyboard layout and cursor behavior influenced early Unix software, especially `vi`. It did not define the modern ECMA-48 stack, but it shaped user-interface conventions. A modern framework does not need ADM-3A protocol support unless it targets retrocomputing, but it should understand that not all terminal history is VT/xterm history.

## E.2 Hazeltine, Televideo, and early smart terminals

Many early terminals used proprietary escape controls. They are mostly represented today through historical termcap/terminfo entries. Common patterns include:

- direct cursor addressing with row/column offsets;
- erase-to-end-of-line/screen controls;
- standout/reverse modes;
- insert/delete line controls;
- local editing modes.

Support strategy: rely on terminfo if targeting them; do not hard-code unless building an emulator.

## E.3 Wyse WY-50 / WY-60

Wyse terminals were widely used in business/minicomputer environments. They include modes and controls that differ from DEC VT behavior. Some terminfo entries still preserve Wyse capabilities. A TUI framework can support them through curses/terminfo but should not assume xterm mouse, OSC, or Unicode.

## E.4 HP terminals

HP terminals, such as HP 262x/239x families, used HP-specific control sequences. They may include block-mode or forms-oriented behavior that does not map directly to character-cell TUIs. Treat as terminfo-only unless compatibility is a goal.

## E.5 IBM 3270 and 5250

IBM 3270/5250 terminals are not simple ANSI byte-stream terminals. They are structured, field-oriented terminals:

- screen is a buffer of fields with attributes;
- host sends structured orders rather than arbitrary ANSI cursor moves;
- input is often submitted as an attention/action event;
- terminal emulation is protocol-level, not just escape-sequence parsing.

A TUI framework for ANSI terminals should not claim native 3270/5250 support. Integration requires a separate backend or bridge.

## E.6 Tektronix 4010/4014

Tektronix terminals are vector-graphics terminals. xterm can emulate Tektronix mode. They are relevant for plotting history, not mainstream TUI widgets. Do not confuse Tektronix vector graphics with Sixel raster graphics.

## E.7 Sun console and shelltool sequences

SunView/shelltool influenced some xterm window manipulation sequences. These became part of xterm's broader de facto extension set. Treat window operations as user-policy-controlled because they affect the GUI window.

## E.8 SCO console, QNX console, AT&T, and vendor consoles

Unix vendors often shipped console-specific sequences. Many are captured by terminfo entries. Their relevance today is mainly:

- migration/legacy applications;
- terminfo database completeness;
- avoiding xterm-only assumptions.

## E.9 DOS ANSI.SYS and PC console heritage

DOS `ANSI.SYS` supported a subset of ANSI-like sequences and PC-specific keyboard handling. It matters historically and for old software, but modern Windows terminal support is based on Virtual Terminal Sequences and/or Console APIs, not pure ANSI.SYS compatibility.

---

# Appendix F — More complete ECMA-48 / ISO 6429 control function catalog

This is a compact engineering catalog. Not every function is implemented by every terminal.

## F.1 C0 control functions

| Code | Mnemonic | Name                   | TUI relevance                       |
| ---: | -------- | ---------------------- | ----------------------------------- |
| 0x00 | NUL      | Null                   | padding/ignored                     |
| 0x01 | SOH      | Start of Heading       | input control key only              |
| 0x02 | STX      | Start of Text          | input control key only              |
| 0x03 | ETX      | End of Text            | Ctrl+C / signal                     |
| 0x04 | EOT      | End of Transmission    | Ctrl+D / EOF in canonical mode      |
| 0x05 | ENQ      | Enquiry                | may trigger answerback historically |
| 0x06 | ACK      | Acknowledge            | rarely used                         |
| 0x07 | BEL      | Bell                   | alert / OSC terminator              |
| 0x08 | BS       | Backspace              | cursor left                         |
| 0x09 | HT       | Horizontal Tab         | tab stops                           |
| 0x0A | LF       | Line Feed              | newline/scroll                      |
| 0x0B | VT       | Vertical Tab           | rarely used                         |
| 0x0C | FF       | Form Feed              | rarely used                         |
| 0x0D | CR       | Carriage Return        | column 1                            |
| 0x0E | SO       | Shift Out              | invoke G1                           |
| 0x0F | SI       | Shift In               | invoke G0                           |
| 0x10 | DLE      | Data Link Escape       | rarely used                         |
| 0x11 | DC1      | XON                    | flow control                        |
| 0x12 | DC2      | Device Control 2       | rarely used                         |
| 0x13 | DC3      | XOFF                   | flow control                        |
| 0x14 | DC4      | Device Control 4       | rarely used                         |
| 0x15 | NAK      | Negative Ack           | Ctrl+U line kill historically       |
| 0x16 | SYN      | Synchronous Idle       | rarely used                         |
| 0x17 | ETB      | End Transmission Block | rarely used                         |
| 0x18 | CAN      | Cancel                 | abort sequence                      |
| 0x19 | EM       | End of Medium          | rarely used                         |
| 0x1A | SUB      | Substitute             | abort/replace                       |
| 0x1B | ESC      | Escape                 | sequence introducer                 |
| 0x1C | FS       | File Separator         | rarely used                         |
| 0x1D | GS       | Group Separator        | rarely used                         |
| 0x1E | RS       | Record Separator       | rarely used                         |
| 0x1F | US       | Unit Separator         | rarely used                         |
| 0x7F | DEL      | Delete                 | input erase in some modes           |

## F.2 C1 control functions

| 8-bit | 7-bit    | Mnemonic | Meaning                             |
| ----: | -------- | -------- | ----------------------------------- |
|  0x80 | `ESC @`  | PAD      | Padding character                   |
|  0x81 | `ESC A`  | HOP      | High octet preset                   |
|  0x82 | `ESC B`  | BPH      | Break permitted here                |
|  0x83 | `ESC C`  | NBH      | No break here                       |
|  0x84 | `ESC D`  | IND      | Index                               |
|  0x85 | `ESC E`  | NEL      | Next line                           |
|  0x86 | `ESC F`  | SSA      | Start selected area                 |
|  0x87 | `ESC G`  | ESA      | End selected area                   |
|  0x88 | `ESC H`  | HTS      | Horizontal tab set                  |
|  0x89 | `ESC I`  | HTJ      | Horizontal tab with justification   |
|  0x8A | `ESC J`  | VTS      | Vertical tab set                    |
|  0x8B | `ESC K`  | PLD      | Partial line down                   |
|  0x8C | `ESC L`  | PLU      | Partial line up                     |
|  0x8D | `ESC M`  | RI       | Reverse index                       |
|  0x8E | `ESC N`  | SS2      | Single shift 2                      |
|  0x8F | `ESC O`  | SS3      | Single shift 3                      |
|  0x90 | `ESC P`  | DCS      | Device control string               |
|  0x91 | `ESC Q`  | PU1      | Private use 1                       |
|  0x92 | `ESC R`  | PU2      | Private use 2                       |
|  0x93 | `ESC S`  | STS      | Set transmit state                  |
|  0x94 | `ESC T`  | CCH      | Cancel character                    |
|  0x95 | `ESC U`  | MW       | Message waiting                     |
|  0x96 | `ESC V`  | SPA      | Start protected area                |
|  0x97 | `ESC W`  | EPA      | End protected area                  |
|  0x98 | `ESC X`  | SOS      | Start of string                     |
|  0x99 | `ESC Y`  | SGCI     | Single graphic character introducer |
|  0x9A | `ESC Z`  | SCI      | Single character introducer         |
|  0x9B | `ESC [`  | CSI      | Control sequence introducer         |
|  0x9C | `ESC \\` | ST       | String terminator                   |
|  0x9D | `ESC ]`  | OSC      | Operating system command            |
|  0x9E | `ESC ^`  | PM       | Privacy message                     |
|  0x9F | `ESC _`  | APC      | Application program command         |

## F.3 Additional CSI functions often forgotten

| Function | Sequence           | Notes                                        |
| -------- | ------------------ | -------------------------------------------- |
| ICH      | `CSI Ps @`         | Insert blank chars.                          |
| SL       | `CSI Ps SP @`      | Shift left; not universally supported.       |
| SR       | `CSI Ps SP A`      | Shift right; not universally supported.      |
| GSM      | `CSI Ps ; Ps SP B` | Graphic size modification; rarely supported. |
| GSS      | `CSI Ps SP C`      | Graphic size selection; rarely supported.    |
| FNT      | `CSI Ps ; Ps SP D` | Font selection; rarely supported.            |
| TSS      | `CSI Ps SP E`      | Thin space specification.                    |
| JFY      | `CSI Ps SP F`      | Justify.                                     |
| SPI      | `CSI Ps ; Ps SP G` | Spacing increment.                           |
| QUAD     | `CSI Ps SP H`      | Quad.                                        |
| SSU      | `CSI Ps SP I`      | Select size unit.                            |
| PFS      | `CSI Ps SP J`      | Page format selection.                       |
| SHS      | `CSI Ps SP K`      | Select horizontal spacing.                   |
| SVS      | `CSI Ps SP L`      | Select vertical spacing.                     |
| IGS      | `CSI Ps SP M`      | Identify graphic subrepertoire.              |
| IDCS     | `CSI Ps SP O`      | Identify device control string.              |
| PPA      | `CSI Ps SP P`      | Page position absolute.                      |
| PPR      | `CSI Ps SP Q`      | Page position relative.                      |
| PPB      | `CSI Ps SP R`      | Page position backward.                      |
| SPD      | `CSI Ps SP S`      | Select presentation directions.              |
| DTA      | `CSI Ps ; Ps SP T` | Dimension text area.                         |
| SHL      | `CSI Ps SP U`      | Select character path / line orientation.    |
| SLL      | `CSI Ps SP V`      | Set line limit.                              |
| FNK      | `CSI Ps SP W`      | Function key.                                |
| SPQR     | `CSI Ps SP X`      | Select print quality and rapidity.           |
| SEF      | `CSI Ps ; Ps SP Y` | Sheet eject and feed.                        |
| PEC      | `CSI Ps SP Z`      | Presentation expand/compress.                |
| SSW      | `CSI Ps SP [`      | Set space width.                             |
| SACS     | `CSI Ps SP \\`     | Set additional character separation.         |
| SAPV     | `CSI Ps SP ]`      | Select alternative presentation variants.    |
| STAB     | `CSI Ps SP ^`      | Selective tabulation.                        |
| GCC      | `CSI Ps SP _`      | Graphic character combination.               |
| TATE     | `CSI Ps SP ``      | Tabulation aligned trailing edge.            |
| TALE     | `CSI Ps SP a`      | Tabulation aligned leading edge.             |
| TAC      | `CSI Ps SP b`      | Tabulation aligned centered.                 |
| TCC      | `CSI Ps SP c`      | Tabulation centered on character.            |
| TSR      | `CSI Ps SP d`      | Tabulation stop remove.                      |
| SCO      | `CSI Ps SP e`      | Select character orientation.                |
| SRCS     | `CSI Ps SP f`      | Set reduced character separation.            |
| SCS      | `CSI Ps SP g`      | Set character spacing.                       |
| SLS      | `CSI Ps SP h`      | Set line spacing.                            |

Many of these are formal ECMA-48 functions but are effectively irrelevant to mainstream terminal emulators. A parser should recognize their syntax; a renderer can ignore them unless implementing full ECMA conformance.

---

# Appendix G — Expanded DEC/xterm private and extension catalog

## G.1 Reset and alignment

| Sequence  | Name   | Meaning                                                 |
| --------- | ------ | ------------------------------------------------------- |
| `ESC c`   | RIS    | Full reset / Reset to Initial State. Dangerous in apps. |
| `ESC # 8` | DECALN | Screen alignment test; fills screen with `E`.           |
| `CSI ! p` | DECSTR | Soft terminal reset.                                    |

## G.2 DEC selective erase

Selective erase affects erasable/protected cells depending character protection modes.

| Sequence     | Name   | Meaning                     |
| ------------ | ------ | --------------------------- |
| `CSI ? Ps J` | DECSED | Selective erase in display. |
| `CSI ? Ps K` | DECSEL | Selective erase in line.    |

Most TUIs do not use protected fields; support varies.

## G.3 Rectangular attribute operations

| Sequence                         | Name     | Meaning                               |
| -------------------------------- | -------- | ------------------------------------- |
| `CSI Pt ; Pl ; Pb ; Pr ; Ps $ r` | DECCARA  | Change attributes in rectangle.       |
| `CSI Pt ; Pl ; Pb ; Pr ; Ps $ t` | DECRARA  | Reverse attributes in rectangle.      |
| `CSI Ps * x`                     | DECSACE  | Select attribute change extent.       |
| `CSI Pt ; Pl ; Pb ; Pr $ w`      | DECRQCRA | Request checksum of rectangular area. |

## G.4 Column insertion/deletion

| Sequence     | Name  | Meaning         |
| ------------ | ----- | --------------- |
| `CSI Ps ' }` | DECIC | Insert columns. |
| `CSI Ps ' ~` | DECDC | Delete columns. |

Useful for terminal emulators/editors but rarely used by modern diff renderers.

## G.5 xterm SGR stack and palette stack

| Sequence  | Meaning             |
| --------- | ------------------- |
| `CSI # {` | Push SGR stack.     |
| `CSI # }` | Pop SGR stack.      |
| `CSI # P` | Push color palette. |
| `CSI # Q` | Pop color palette.  |

These are not universal. Prefer explicit style tracking in the framework.

## G.6 XTVERSION and resource queries

| Sequence                           | Meaning                                            |
| ---------------------------------- | -------------------------------------------------- |
| `CSI > 0 q` or related xterm forms | Request terminal version depending implementation. |
| `DCS + Q ... ST`                   | XTGETXRES query xterm resource value.              |
| `DCS + q ... ST`                   | XTGETTCAP query termcap/terminfo capability.       |

Exact forms and responses should be implemented from xterm documentation and tested.

---

# Appendix H — Extended OSC catalog

This list is intentionally broad. Many entries are terminal-specific and should be gated.

|         OSC | Common meaning                                  | Portability                     |
| ----------: | ----------------------------------------------- | ------------------------------- |
|           0 | Icon + window title                             | common                          |
|           1 | Icon name                                       | common                          |
|           2 | Window title                                    | common                          |
|           3 | xterm property                                  | xterm-specific                  |
|           4 | Palette color set/query                         | xterm-like                      |
|           5 | Special color                                   | xterm-like                      |
|           6 | Special color variant                           | limited                         |
|           7 | Current directory URI                           | common modern shell integration |
|           8 | Hyperlink                                       | common modern                   |
|           9 | Notification / iTerm2 variants                  | nonstandard                     |
|         9;4 | Progress indicator in some terminals            | nonstandard                     |
|          10 | Foreground color                                | xterm-like                      |
|          11 | Background color                                | xterm-like                      |
|          12 | Cursor color                                    | xterm-like                      |
|          17 | Highlight background                            | xterm-like                      |
|          19 | Highlight foreground                            | xterm-like                      |
|          21 | Kitty color protocol / terminal-specific        | nonstandard                     |
|          22 | Pointer shape in some ecosystems                | nonstandard                     |
|          50 | Font in xterm / historical conflict with iTerm2 | avoid                           |
|          52 | Clipboard                                       | common but security-gated       |
|          66 | Text sizing in some ecosystems                  | nonstandard                     |
|          99 | Kitty desktop notifications                     | modern extension                |
|         104 | Reset palette                                   | xterm-like                      |
|         105 | Reset special color                             | xterm-like                      |
|         110 | Reset foreground                                | xterm-like                      |
|         111 | Reset background                                | xterm-like                      |
|         112 | Reset cursor color                              | xterm-like                      |
|     113/114 | Reset pointer colors                            | terminal-specific               |
|     117/119 | Reset highlight colors                          | xterm-like                      |
|         133 | Shell integration marks                         | common modern                   |
|         176 | Wayland app-id in some terminals                | terminal-specific               |
|         440 | Audio/sound in some terminals                   | terminal-specific               |
|         555 | Screen flash in some terminals                  | terminal-specific               |
|         633 | VS Code shell integration                       | host-specific                   |
|         666 | VTE termprops                                   | VTE-specific                    |
|     701/702 | Locale/version query-set variants               | terminal-specific               |
|         710 | Font query/set variants                         | terminal-specific               |
|         720 | Scroll view variants                            | terminal-specific               |
|         776 | Cell size report variants                       | terminal-specific               |
|         777 | Notification variants                           | terminal-specific               |
|        1337 | iTerm2 proprietary protocols                    | iTerm2/compatible               |
|        3008 | systemd context                                 | specific ecosystem              |
|        5522 | advanced clipboard variants                     | emerging/nonstandard            |
|   7770/7777 | font/window sizing variants                     | terminal-specific               |
| 30001/30101 | Kitty color stack push/pop                      | Kitty-specific                  |

Policy: unknown OSC sequences from untrusted data should be stripped or visibly escaped.

---

# Appendix I — Framework-specific semantic abstractions

Raw protocols are not the API your users should code against. Suggested abstractions:

## I.1 Style abstraction

```text
Style {
  fg: Color | Default,
  bg: Color | Default,
  underline_color: Color | Default,
  bold: bool,
  dim: bool,
  italic: bool,
  underline: none | single | double | curly | dotted | dashed,
  reverse: bool,
  hidden: bool,
  strike: bool,
  overline: bool,
}
```

Renderer maps this to SGR according to capabilities.

## I.2 Color abstraction

```text
Color =
  Default
  Ansi(index 0..15)
  Indexed(index 0..255)
  Rgb(r,g,b)
  Theme(name)
```

Policy decides whether RGB is downgraded to 256/16 colors.

## I.3 Image abstraction

```text
ImageRequest {
  source: bytes | file | decoded_pixels,
  size_policy: cells | pixels | fit | contain | cover,
  alpha_policy: preserve | flatten(bg),
  fallback: unicode | placeholder | external,
}
```

Backend chooses Kitty/Sixel/iTerm2/Unicode.

## I.4 Input abstraction

```text
InputEvent =
  Key { key, modifiers, physical, text, kind }
  Text { graphemes }
  Mouse { kind, button, position, modifiers }
  Paste { text, raw_bytes }
  Focus { focused }
  Resize { rows, cols, pixel_width, pixel_height }
```

Do not expose raw escape sequences as the normal widget API.

## I.5 Security abstraction

```text
TrustLevel =
  FrameworkGenerated
  ApplicationTrusted
  UserPasted
  RemoteProcess
  LogFile
  AIOrChatOutput
```

Each trust level maps to allowed protocols.

---

# Appendix J — What a truly exhaustive research corpus should include

If you want to push beyond this v3 into an archival corpus, collect and index:

1. ECMA-6, ECMA-35, ECMA-43, ECMA-48.
2. ISO 2022, ISO 6429, ISO 646 references.
3. ANSI X3.64 historical documents.
4. DEC VT52, VT100, VT102, VT125, VT220, VT240, VT320, VT330, VT340, VT420, VT510, VT520, VT525 manuals.
5. DEC STD 070 Video Systems Reference Manual.
6. xterm `ctlseqs` for the current patch and historical diffs.
7. ncurses `terminfo.src` and extended capability docs.
8. termcap historical databases.
9. Linux console documentation and kernel console code.
10. FreeBSD `vt` / syscons docs.
11. Windows Console and ConPTY docs.
12. Kitty keyboard, graphics, notifications, shell integration docs.
13. iTerm2 proprietary escape code and images docs.
14. WezTerm escape sequence docs.
15. Ghostty VT docs.
16. foot, Contour, mintty, mlterm, VTE, Alacritty, Rio, Terminal.app docs.
17. xterm.js feature tables and parser behavior.
18. tmux and GNU screen manuals.
19. Sixel, ReGIS, Tektronix, DRCS references.
20. Unicode Standard, UAX #11, UAX #14, UAX #29, UAX #31 where relevant.
21. `wcwidth` implementations and terminal width test suites.
22. Security write-ups on terminal escape injection and OSC 52.
23. Test suites: vttest, notcurses tests, terminal feature tests, terminfo.dev matrix.

This v3 is structured so those sources can be added as machine-readable entries later.

---

# Part IX — Terminal-by-Terminal Standards Profiles

> Purpose: this part maps standards, de facto standards, and proprietary protocols to concrete terminals and terminal-like environments. It is meant to be used as a design input for a TUI framework capability database.
>
> Important: terminal support changes over time and often depends on user configuration, operating system, terminal version, whether the application runs through `tmux`, `screen`, SSH, a browser terminal, or ConPTY, and whether the terminal is running locally or remotely. Treat the following profiles as **default assumptions**, not as proof. A serious framework must combine these profiles with `terminfo`, environment detection, runtime probes, and safe fallbacks.

## IX.1 Classification System

### IX.1.1 Standard Families

Use these labels consistently in the framework:

| Label           | Meaning                                                         | Examples                                                                                                      |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **FORMAL**      | Published general standard or operating-system standard         | ASCII, ISO 646, ISO 2022, ECMA-35, ECMA-48 / ISO 6429, POSIX `termios`, Unicode                               |
| **DEC**         | DEC hardware terminal behavior or DEC private extensions        | VT52, VT100, VT102, VT220, VT320, VT420, VT510/520/525, DEC private modes, DEC Special Graphics, Sixel, ReGIS |
| **XTERM**       | xterm behavior used as a de facto compatibility target          | xterm `ctlseqs`, OSC 4/8/10/11/12/52, focus tracking, bracketed paste, modifyOtherKeys, SGR mouse, XTGETTCAP  |
| **VTE**         | GNOME/VTE behavior and conventions                              | OSC 7 current directory, OSC 8 hyperlinks, VTE environment variables, some semantic prompt conventions        |
| **KITTY**       | Kitty-originated extensions                                     | Kitty keyboard protocol, Kitty graphics protocol, Kitty color stack, Kitty pointer and desktop extensions     |
| **ITERM2**      | iTerm2-originated extensions                                    | OSC 1337 inline images, ReportCellSize, Copy, annotations, proprietary shell integration helpers              |
| **FINALTERM**   | Semantic prompt marks adopted by iTerm2, WezTerm, VS Code, etc. | OSC 133 A/B/C/D/P                                                                                             |
| **VSCODE**      | VS Code integrated terminal extensions                          | OSC 633 prompt integration and command metadata                                                               |
| **WINDOWS**     | Microsoft console / ConPTY / Windows Terminal behavior          | Win32 Console API, ENABLE_VIRTUAL_TERMINAL_PROCESSING, VT input mode, ConPTY bridge                           |
| **WEB**         | Browser terminal implementations and constraints                | xterm.js parser, hterm, sandboxed OSC handling                                                                |
| **MULTIPLEXER** | Terminal multiplexer protocol translation and passthrough       | tmux, GNU screen, Zellij, WezTerm mux                                                                         |
| **PROPRIETARY** | Vendor-specific behavior with no broad standardization          | Warp blocks, older terminal-specific escape codes, terminal app automation APIs                               |

### IX.1.2 Capability Levels

Use these levels instead of a boolean whenever possible:

| Level            | Meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Native**       | The terminal implements the protocol itself.                                       |
| **Compatible**   | The terminal intentionally emulates another protocol well enough for applications. |
| **Partial**      | Some sequences work, but not the complete protocol or not all modes.               |
| **Config-gated** | Works only when a setting is enabled.                                              |
| **Proxy**        | Works only through a passthrough mechanism or a multiplexer translation layer.     |
| **Blocked**      | The terminal, OS layer, multiplexer, browser, or security policy blocks it.        |
| **Unknown**      | Do not assume support. Probe or fall back.                                         |

### IX.1.3 Framework Policy from a Profile

For every detected terminal, the framework should produce a `TerminalProfile` like this:

```text
TerminalProfile {
  identity: {
    term: "$TERM",
    term_program: "$TERM_PROGRAM",
    terminal_emulator: "$TERMINAL_EMULATOR",
    vte_version: "$VTE_VERSION",
    wezterm: "$WEZTERM_*",
    kitty: "$KITTY_*",
    wt_session: "$WT_SESSION",
    conemu: "$ConEmuANSI",
    tmux: "$TMUX",
    screen: "$STY",
    ssh: "$SSH_TTY"
  },
  lineage: [FORMAL, DEC, XTERM, ...],
  output: { sgr, truecolor, hyperlinks, clipboard, images, synchronized_output },
  input: { legacy_keys, modify_other_keys, csi_u, kitty_keyboard, focus, paste },
  mouse: { x10, normal, button_event, any_event, sgr, urxvt, utf8, pixel },
  graphics: { sixel, kitty_graphics, iterm2_images, regis, tektronix, unicode_fallback },
  transport: { raw_tty, pty, ssh, tmux, screen, conpty, browser },
  security: { osc52_policy, hyperlink_policy, image_policy, dcs_policy },
  confidence: { static_db, terminfo, env, probes, user_override }
}
```

## IX.2 Global Matrix — Modern Terminals and Protocol Families

Legend: `N` = native, `C` = compatible, `P` = partial, `G` = gated/configurable, `X` = generally unsupported, `?` = version-dependent or must probe.

| Terminal / Environment            | ECMA-48 / ANSI | DEC VT / xterm |     terminfo | Truecolor |   OSC 8 |  OSC 52 | Bracketed Paste | Focus | SGR Mouse |        Kitty Keyboard | modifyOtherKeys / CSI-u |        Sixel | Kitty Graphics | iTerm2 Images | Shell Marks | Notes                                              |
| --------------------------------- | -------------: | -------------: | -----------: | --------: | ------: | ------: | --------------: | ----: | --------: | --------------------: | ----------------------: | -----------: | -------------: | ------------: | ----------: | -------------------------------------------------- |
| **xterm**                         |              N |              N |            N |         C |       C |     C/G |               C |     C |         C |                     X |                       N |            G |              X |             X |           P | De facto reference for many control sequences.     |
| **VTE / GNOME Terminal**          |              C |              C |            N |         C |       C |       G |               C |     C |         C |                   X/P |                       P |          X/P |              X |             X |           C | Common Linux desktop baseline.                     |
| **Konsole**                       |              C |              C |            N |         C |       C |       G |               C |     C |         C |                   P/? |                     P/? |          C/G |            P/? |           X/P |           C | KDE terminal; features vary by version.            |
| **iTerm2**                        |              C |              C |            N |         C |       N |       G |               C |     C |         C |                     P |                       P |          P/? |            P/? |             N |           N | macOS-only, rich OSC 1337 ecosystem.               |
| **Terminal.app**                  |              C |            C/P |            N |         C |     P/? |     X/P |               C |     P |       C/P |                     X |                     X/P |            X |              X |             X |           P | Conservative macOS terminal.                       |
| **Kitty**                         |              C |              C |            N |         N |       N |       G |               N |     N |         N |                     N |                       N |            X |              N |           P/C |           N | Origin of Kitty keyboard/graphics.                 |
| **WezTerm**                       |              C |              C |            N |         N |       N |       G |               N |     N |         N |                   N/G |                     N/G |          C/G |            P/C |           N/C |           N | Cross-platform terminal + multiplexer.             |
| **Ghostty**                       |              C |              C |            N |         N |       N |       G |               N |     N |         N |                     N |                     P/? | X by design? |              N |           P/? |           N | Modern xterm-compatible terminal.                  |
| **Alacritty**                     |              C |              C |            N |         N |       N |       G |               N |     N |         N | P/N depending version |                     P/N |            X |            X/P |             X |           P | Minimal terminal; avoids many rich protocols.      |
| **foot**                          |              C |              C |            N |         N |       N |       G |               N |     N |         N |                   P/N |                     P/N |            N |              X |             X |           P | Wayland-focused, strong Sixel support.             |
| **Windows Terminal**              |            P/C | C via VT layer |            P |         C |       C |     P/G |               C |     P |         C |                   P/? |                     P/? |          P/? |            X/P |           P/? |         C/P | Depends on ConPTY and app mode.                    |
| **Windows Console Host**          |              P |              P |            P |         P |     X/P |     X/P |               P |   X/P |         P |                     X |                     X/P |            X |              X |             X |         X/P | Historically API-first, VT layer added later.      |
| **mintty**                        |              C |              C |            N |         N |       N |       G |               N |     N |         N |                   P/? |                       P |            N |            X/P |             P |           C | Cygwin/MSYS2 terminal; xterm-like.                 |
| **PuTTY**                         |            P/C |            P/C |            N |       P/C |     P/? |       G |               C |     P |       P/C |                     X |                       P |          X/P |              X |             X |           P | SSH client with independent terminal emulator.     |
| **tmux**                          |          Proxy |          Proxy |  Own entries |     Proxy | Proxy/G | Proxy/G |           Proxy | Proxy |     Proxy |               Proxy/P |                 Proxy/P |      Proxy/G |        Proxy/G |       Proxy/G |     Proxy/G | Must handle outer terminal separately.             |
| **GNU screen**                    |          Proxy |        Proxy/P |  Own entries |         P |     P/X |     P/X |               P |   P/X |         P |                     X |                     X/P |          X/P |              X |             X |         P/X | Older multiplexer, more destructive to extensions. |
| **Zellij**                        |          Proxy |          Proxy | Own behavior |     Proxy |   Proxy | Proxy/G |           Proxy | Proxy |     Proxy |                   P/? |                     P/? |      Proxy/G |        Proxy/G |       Proxy/G |       Proxy | Rust multiplexer; support evolves quickly.         |
| **xterm.js**                      |            C/P |            C/P |  App-defined |         C |     C/P |     G/X |               C |   C/P |         C |                   X/P |                       P |      X/addon |        X/addon |       X/addon |         C/P | Browser security model controls features.          |
| **VS Code Integrated Terminal**   | xterm.js-based | xterm.js-based |  App-defined |         C |       C |       G |               C |     C |         C |                   X/P |                       P |      X/addon |        X/addon |       X/addon |           N | OSC 633 is important.                              |
| **hterm / ChromeOS Secure Shell** |            C/P |            C/P |  App-defined |         C |     C/P |       G |               C |     P |       C/P |                     X |                       P |            X |              X |             X |           P | Browser/extension sandbox.                         |

## IX.3 Historical Hardware Terminal Profiles

### IX.3.1 ADM-3A

- **Era:** mid-1970s.
- **Standard family:** pre-ANSI / vendor-specific ASCII control behavior.
- **Importance:** historically influenced Unix conventions such as `hjkl` movement in `vi` because of keyboard layout and cursor key placement.
- **Protocol shape:** mostly printable ASCII plus C0 controls and simple cursor controls.
- **Not a modern TUI target:** do not implement a dedicated ADM-3A backend unless building a retro compatibility layer.
- **Framework policy:** use only as historical context. For modern code, support `TERM=dumb` and `TERM=unknown` rather than trying to emulate ADM-3A.

### IX.3.2 DEC VT52

- **Era:** 1975.
- **Standard family:** DEC pre-ANSI.
- **Escape style:** short `ESC` sequences rather than ECMA-48 CSI sequences.
- **Examples:** cursor addressing and movement use VT52-specific syntax, not ANSI `CSI H`, `CSI A`, etc.
- **Graphics:** no Sixel; far earlier than DEC graphics terminals.
- **Modern relevance:** mostly only through xterm VT52 compatibility mode and historical documents.
- **Framework policy:** do not target VT52 as a normal backend. A framework parser may recognize VT52 mode only if emulating a terminal, not for a TUI application.

### IX.3.3 DEC VT100

- **Era:** 1978.
- **Standards:** ANSI X3.64 / ECMA-48 style CSI, DEC private modes.
- **Core features:** cursor movement, erase, scrolling region, origin mode, auto-wrap, application cursor keys, keypad modes, character set designation, DEC Special Graphics.
- **Screen model:** 80 columns, optional 132-column mode on some models; fixed cell grid.
- **Color:** no color.
- **Mouse:** no mouse protocol.
- **Images:** no images.
- **Framework policy:** VT100 is the minimum historical mental model, but too limited for a modern TUI. Use it as a fallback baseline for cursor, erase, scroll region, line drawing, and alternate keypad/cursor mode behavior.

### IX.3.4 DEC VT102

- **Era:** early 1980s.
- **Relationship:** VT100-compatible with additional editing and printer-related capabilities.
- **Standards:** DEC + ECMA-48-derived behavior.
- **Modern relevance:** many “ANSI terminal” descriptions really mean a VT100/VT102-like subset.
- **Framework policy:** treat VT102 as a compatibility baseline below xterm. Do not assume color, mouse, OSC, DCS graphics, hyperlinks, or clipboard.

### IX.3.5 DEC VT125 / VT240 / VT241 / VT330 / VT340

- **Standards:** DEC text terminal behavior plus graphics features depending on model.
- **Graphics:** ReGIS and/or Sixel on graphics-capable models.
- **Importance:** source lineage for terminal graphics before modern raster protocols.
- **Framework policy:** if Sixel is supported, prefer Sixel for broad compatibility through xterm-compatible terminals and some multiplexers. ReGIS is mostly historical and should be optional.

### IX.3.6 DEC VT220

- **Era:** 1983.
- **Standards:** more complete DEC + ANSI behavior, 8-bit C1 controls, ISO 2022 character sets, national replacement character sets.
- **Input:** function-key sequences, application modes, more structured keyboard behavior than VT100.
- **Character sets:** G0/G1/G2/G3, locking shifts, single shifts.
- **Modern relevance:** xterm and many terminal emulators claim VT220-like ancestry through DA2 responses.
- **Framework policy:** support the VT220/xterm function-key sequence families and ISO 2022/DEC Special Graphics decoding enough to render old applications correctly.

### IX.3.7 DEC VT320 / VT340

- **Standards:** VT220-compatible plus later DEC features.
- **Graphics:** VT340 includes graphics capabilities such as ReGIS/Sixel lineage.
- **Editing:** richer rectangular and area operations appear in later DEC families.
- **Framework policy:** treat as source of DEC rectangle operations, status reports, and Sixel-related capabilities, but do not require them for Core TUI.

### IX.3.8 DEC VT420

- **Standards:** later DEC VT series behavior.
- **Important additions:** left/right margins, rectangular editing operations, more sophisticated status/query behavior.
- **Framework policy:** implement parsing for later DEC sequences if building a terminal emulator or if your TUI wants to preserve unknown sequences safely. For TUI output, only use later DEC features when detected.

### IX.3.9 DEC VT510 / VT520 / VT525

- **Standards:** late DEC video terminal family.
- **Capabilities:** later conformance levels, more complete status reports, compatibility with earlier DEC terminals.
- **Modern relevance:** some terminal emulators report VT5xx-like DA2 identifiers even when behavior is xterm-derived rather than hardware-accurate.
- **Framework policy:** DA responses are hints, not complete feature proofs.

### IX.3.10 Tektronix 4010 / 4014

- **Standard family:** Tektronix vector graphics terminal behavior.
- **Graphics model:** vector plotting rather than character-cell raster graphics.
- **Modern relevance:** xterm historically includes Tektronix mode support.
- **Framework policy:** not a modern TUI target. Keep in the encyclopedia for completeness; do not use for general UI rendering.

### IX.3.11 Wyse WY-50 / WY-60

- **Standard family:** vendor-specific business terminal protocols.
- **Importance:** common in historical Unix/minicomputer environments.
- **Behavior:** escape sequences are not equivalent to VT100/xterm; some terminfo entries exist.
- **Framework policy:** support through `terminfo` only. Do not hard-code Wyse sequences unless explicitly targeting legacy systems.

### IX.3.12 IBM 3270 / 5250

- **Standard family:** block-mode terminal protocols, not byte-stream VT-style terminals.
- **Transport:** mainframe/AS400-style session protocols; applications interact with fields and forms, not a simple scrolling character stream.
- **Modern bridges:** `tn3270`, 3270 emulators, curses-like libraries for mainframe interaction.
- **Framework policy:** treat as out-of-scope for normal PTY TUI frameworks. A dedicated adapter would be a separate backend, not a VT parser variant.

## IX.4 Unix and Linux Terminal Profiles

### IX.4.1 Linux Virtual Console

- **Environment:** kernel virtual console, typically `TERM=linux`.
- **Standards:** Linux-console-specific subset of ECMA-48/DEC-like behavior.
- **Color:** 16-color and palette behavior; not equivalent to modern GUI truecolor terminals.
- **Character sets:** historically PC/VGA and Linux console mapping behavior; Unicode support exists but differs from GUI terminals.
- **Mouse:** normally not native in the same way; often handled through `gpm` or not available.
- **Images:** no modern inline image protocol.
- **OSC:** very limited compared to xterm-compatible GUI terminals.
- **Framework policy:** use conservative output: basic SGR, cursor movement, erase, scroll region. Avoid OSC 8, OSC 52, Kitty graphics, iTerm2 images, and truecolor unless explicitly verified.

### IX.4.2 FreeBSD `vt` Console

- **Environment:** FreeBSD kernel console.
- **Standards:** console-specific VT-like subset.
- **termcap/terminfo:** must be trusted more than emulator name.
- **Graphics:** no modern terminal image protocols.
- **Framework policy:** treat similarly to Linux console: conservative ANSI/ECMA-48 subset, avoid rich extensions by default.

### IX.4.3 OpenBSD / NetBSD Console

- **Environment:** OS console drivers, not GUI terminal emulators.
- **Standards:** VT-like subsets and OS-specific behavior.
- **Framework policy:** rely on terminfo. Disable rich protocols unless probed and confirmed.

### IX.4.4 Serial Terminals and Embedded UART Consoles

- **Environment:** microcontrollers, routers, serial consoles, recovery shells.
- **Standards:** often `vt100`, `ansi`, or `dumb` subsets.
- **Constraints:** slow transport, no query response reliability, no images, no clipboard, no mouse, limited colors.
- **Framework policy:** include a low-bandwidth renderer mode: minimal redraw, no synchronized output assumptions, no probes that can hang the session.

## IX.5 xterm and xterm-Compatible GUI Terminals

### IX.5.1 xterm

- **Identity:** often `TERM=xterm`, `xterm-256color`, or a variant.
- **Standard lineage:** FORMAL + DEC + XTERM.
- **Role:** the most important de facto reference for terminal control sequences.
- **Core supported families:**
  - ECMA-48 C0/C1, ESC, CSI, OSC, DCS.
  - VT100/VT102 and many later DEC sequences.
  - DEC private modes.
  - ISO 2022 character set designation and DEC Special Graphics.
  - xterm OSC color controls.
  - xterm mouse tracking modes.
  - bracketed paste.
  - focus tracking.
  - SGR mouse.
  - modifyOtherKeys.
  - XTGETTCAP / XTSETTCAP-style DCS queries.
- **Graphics:** Sixel is optional/configuration/build dependent; Tektronix mode exists historically.
- **Input:** legacy sequences, application cursor/keypad, modifyOtherKeys, focus, bracketed paste. Kitty keyboard is not the native xterm path.
- **OSC:** titles, palette, colors, OSC 8 hyperlinks, OSC 52 clipboard depending configuration, and many xterm-defined controls.
- **Framework policy:** xterm is the compatibility oracle. If your behavior differs from xterm for a shared sequence, you need a strong reason. Use xterm profile as the base for most non-proprietary GUI terminals.

### IX.5.2 rxvt / urxvt

- **Identity:** `rxvt`, `rxvt-unicode`, `rxvt-unicode-256color`.
- **Lineage:** DEC/xterm-like but with rxvt-specific behavior.
- **Mouse:** urxvt introduced `CSI ? 1015 h` mouse reporting, later superseded by SGR mouse.
- **OSC:** supports some xterm-style OSC controls, but not all.
- **Unicode:** urxvt is Unicode-oriented but older than modern grapheme-cluster expectations.
- **Framework policy:** prefer SGR mouse if present; otherwise detect urxvt mode only as fallback. Avoid assuming modern Kitty/iTerm2 features.

### IX.5.3 VTE / GNOME Terminal / Tilix / Terminator / XFCE Terminal

- **Identity:** often `TERM=xterm-256color`, `VTE_VERSION` set.
- **Lineage:** FORMAL + DEC + XTERM + VTE conventions.
- **Core:** common xterm-compatible ANSI/DEC sequences, truecolor, SGR mouse, bracketed paste, focus tracking, OSC 8 in modern versions.
- **OSC 52:** often restricted or policy-gated for security.
- **OSC 7:** current directory convention is commonly used by VTE-compatible shells.
- **Graphics:** no broad native Kitty graphics or iTerm2 image protocol as a baseline; Sixel support depends on version/build and is not universal.
- **Input:** legacy and xterm-like input; Kitty keyboard is not the safe default.
- **Framework policy:** use as a strong Modern TUI target: truecolor, SGR mouse, bracketed paste, focus, OSC 8. Probe clipboard and images.

### IX.5.4 Konsole

- **Identity:** KDE terminal, often `TERM=xterm-256color`, `KONSOLE_VERSION` may be present.
- **Lineage:** FORMAL + DEC + XTERM + KDE-specific features.
- **Core:** strong xterm-like terminal emulation, truecolor, hyperlinks, mouse, bracketed paste.
- **Graphics:** Sixel support exists in modern Konsole versions; Kitty graphics support has been under active implementation in the ecosystem and must be probed.
- **Input:** xterm-like plus possible CSI-u/Kitty-keyboard-related behavior depending version/config.
- **Framework policy:** treat as a Modern/Rich candidate but probe graphics and enhanced keyboard.

### IX.5.5 mlterm

- **Identity:** multilingual terminal emulator.
- **Lineage:** xterm-compatible with strong multilingual text support.
- **Graphics:** Sixel support has historically been an important feature.
- **Text:** complex scripts and internationalization are more central than in many older emulators.
- **Framework policy:** good candidate for Unicode and Sixel paths, but probe exact capabilities.

## IX.6 macOS Terminal Profiles

### IX.6.1 Apple Terminal.app

- **Identity:** `TERM_PROGRAM=Apple_Terminal`, usually `TERM=xterm-256color`.
- **Lineage:** FORMAL + DEC/xterm-compatible subset.
- **Core:** cursor movement, SGR, 256 colors, truecolor in modern macOS, alternate screen, bracketed paste, mouse support.
- **OSC:** title sequences supported; OSC 8 and OSC 52 behavior depends on macOS version and settings and should not be assumed as broad as iTerm2.
- **Graphics:** no Kitty graphics or iTerm2 inline image baseline.
- **Input:** mostly legacy/xterm-style; do not assume Kitty keyboard.
- **Framework policy:** target Core/Modern text UI, but use conservative rich feature defaults. Probe hyperlinks, clipboard, and enhanced keyboard.

### IX.6.2 iTerm2

- **Identity:** `TERM_PROGRAM=iTerm.app`, `LC_TERMINAL=iTerm2`, often `TERM=xterm-256color`.
- **Lineage:** FORMAL + DEC + XTERM + ITERM2 + FINALTERM.
- **Core:** xterm-compatible sequences, truecolor, bracketed paste, mouse, focus, OSC 8 hyperlinks.
- **OSC 1337:** rich proprietary family including inline images/file transfer, ReportCellSize, annotations, SetColors, Copy, profiles, badge-related features, and more.
- **Images:** iTerm2 inline image protocol via `OSC 1337 ; File = ...`.
- **Shell integration:** FinalTerm-style OSC 133 plus iTerm2-specific shell integration.
- **Input:** legacy/xterm-style plus partial modern keyboard support depending configuration/version. Probe before enabling Kitty-keyboard semantics.
- **tmux integration:** iTerm2 has special tmux integration, but normal applications inside tmux still need multiplexer-aware policy.
- **Security:** proprietary OSCs can change UI state, copy data, request attention, upload/download files, and display images; sanitize untrusted text.
- **Framework policy:** Rich terminal profile. Enable OSC 8 and truecolor; use iTerm2 image protocol when `iTerm2` is detected and not inside a blocking multiplexer; still probe OSC 52 and enhanced keyboard.

### IX.6.3 Warp

- **Identity:** Warp terminal app; environment variables and behavior may be product/version-specific.
- **Lineage:** xterm-compatible terminal core plus proprietary block-oriented UI layer.
- **Core:** supports common terminal behavior needed by shells and TUIs.
- **Shell integration:** central to Warp’s block model; proprietary behavior may exist outside classic escape-sequence semantics.
- **Graphics/input:** must be detected, not assumed.
- **Framework policy:** treat as a modern app terminal for text UI, but avoid depending on undocumented proprietary behavior. Use runtime probes and safe fallback.

### IX.6.4 Ghostty on macOS

- **Identity:** Ghostty environment/profile; macOS native UI.
- **Lineage:** FORMAL + DEC + XTERM + KITTY-compatible modern protocols.
- **Core:** aims for xterm compatibility while supporting modern application-facing protocols.
- **Graphics:** Kitty graphics protocol.
- **Keyboard:** Kitty keyboard protocol.
- **Text:** grapheme clustering and emoji support are major goals; still only left-to-right text layout is a common limitation in many terminals.
- **Framework policy:** Rich terminal profile. Prefer Kitty graphics over Sixel; enable Kitty keyboard only via proper progressive enhancement handshake.

### IX.6.5 WezTerm on macOS

- **Identity:** `WEZTERM_*` variables, `TERM_PROGRAM=WezTerm` in some environments, configurable `term`.
- **Lineage:** FORMAL + DEC + XTERM + ITERM2-compatible + KITTY-compatible + MULTIPLEXER.
- **Core:** xterm-like terminal with truecolor, OSC 8, bracketed paste, SGR mouse.
- **Images:** supports iTerm2 image protocol; Kitty graphics support has varied and should be probed.
- **Keyboard:** configurable CSI-u and Kitty keyboard settings.
- **Multiplexer:** WezTerm has its own mux and SSH domains; terminal identity can differ between local GUI and remote panes.
- **Framework policy:** Rich candidate. Build capabilities from `WEZTERM_*`, terminfo, and probes. Do not assume all rich protocols are enabled.

## IX.7 Modern Cross-Platform Terminal Profiles

### IX.7.1 Kitty

- **Identity:** `TERM=xterm-kitty` by default; `KITTY_WINDOW_ID`, `KITTY_PID`, and related variables may exist.
- **Lineage:** FORMAL + DEC + XTERM + KITTY.
- **Core:** xterm-compatible text terminal with GPU rendering.
- **Keyboard:** origin of the Kitty keyboard protocol; supports progressive enhancement flags, disambiguation, event reporting, alternate keys, all-keys-as-escape, and associated text.
- **Graphics:** origin of Kitty graphics protocol (`ESC _ G ... ESC \`) with direct data, file, and shared-memory transmission; placement and compositing features.
- **Mouse:** xterm mouse modes including SGR mouse and pixel mouse support.
- **OSC:** broad xterm-style OSC support plus Kitty-specific color/pointer/notification extensions.
- **Sixel:** not the main image path; do not assume Sixel support.
- **Framework policy:** Rich terminal profile. Prefer Kitty keyboard and Kitty graphics when detected. Use push/pop for keyboard flags and restore state on exit.

### IX.7.2 WezTerm

- **Identity:** `WEZTERM_*`, configurable `TERM` such as `wezterm`, `xterm-256color`, or custom terminfo.
- **Lineage:** FORMAL + DEC + XTERM + ITERM2-compatible + KITTY-compatible + MULTIPLEXER.
- **Core:** strong xterm-compatible behavior, truecolor, hyperlinks, mouse, bracketed paste.
- **Keyboard:** supports configurable CSI-u / Kitty keyboard related modes; applications should probe or use explicit user opt-in.
- **Images:** iTerm2 image protocol; Kitty graphics support may be partial/version-dependent; probe.
- **Multiplexing:** built-in mux can change transport assumptions; remote panes might not share local capabilities.
- **Framework policy:** implement a dedicated WezTerm profile, but keep feature toggles dynamic.

### IX.7.3 Alacritty

- **Identity:** `ALACRITTY_*` environment in some setups; usually `TERM=alacritty` or `xterm-256color`.
- **Lineage:** FORMAL + DEC + XTERM subset.
- **Core:** fast GPU terminal focused on common terminal emulation rather than a broad proprietary protocol surface.
- **Color:** truecolor.
- **Mouse:** xterm mouse including SGR mouse.
- **OSC:** OSC 8 and OSC 52 support depends on version/config; probe.
- **Keyboard:** CSI-u / Kitty keyboard support has evolved; do not assume full Kitty progressive enhancement unless probe succeeds.
- **Graphics:** no Sixel or Kitty graphics baseline in conservative profiles.
- **Framework policy:** Modern text UI profile. Use truecolor, mouse, bracketed paste, focus; fallback to Unicode-based graphics.

### IX.7.4 foot

- **Identity:** Wayland terminal, usually `TERM=foot` or `foot-extra` when terminfo installed.
- **Lineage:** FORMAL + DEC + XTERM + selected modern extensions.
- **Core:** strong xterm-compatible behavior.
- **Color:** truecolor.
- **Mouse:** xterm/SGR mouse modes.
- **Graphics:** Sixel is an important supported graphics path.
- **Keyboard:** CSI-u / Kitty keyboard support may exist depending version; probe.
- **OSC:** common OSC support such as titles, hyperlinks, and clipboard policy depending configuration.
- **Framework policy:** Modern/Rich terminal profile. Prefer Sixel for images; probe Kitty keyboard and OSC 52.

### IX.7.5 Ghostty

- **Identity:** Ghostty environment and terminal identity; macOS/Linux.
- **Lineage:** FORMAL + DEC + XTERM + KITTY-compatible modern features.
- **Design principle:** xterm compatibility for existing apps plus modern protocols for new apps.
- **Keyboard:** Kitty keyboard protocol.
- **Graphics:** Kitty graphics protocol.
- **Text:** strong Unicode/grapheme support; terminals may still limit bidirectional and complex text layout.
- **Sixel:** do not assume Sixel; Ghostty’s public direction emphasizes Kitty graphics rather than Sixel.
- **Framework policy:** Rich profile. Prefer Kitty protocols; retain fallback for xterm-style behavior.

### IX.7.6 Rio

- **Identity:** modern GPU terminal; exact environment variables and protocol support are version-dependent.
- **Lineage:** xterm-compatible core plus modern extensions.
- **Core:** truecolor, Unicode, SGR, mouse, bracketed paste expected in modern configurations.
- **Keyboard/graphics:** must be probed.
- **Framework policy:** treat as unknown-modern: enable safe Modern features, probe rich extensions.

### IX.7.7 Contour

- **Identity:** modern C++ terminal emulator.
- **Lineage:** xterm/DEC compatibility with modern terminal features.
- **Core:** truecolor, hyperlinks, mouse, bracketed paste are expected modern goals.
- **Graphics:** Sixel support has been associated with Contour; probe exact support.
- **Framework policy:** Modern/Rich candidate via probes.

### IX.7.8 Terminology

- **Identity:** Enlightenment/EFL terminal.
- **Lineage:** xterm-compatible plus its own media-oriented features.
- **Graphics:** historically strong media/image behavior compared to conservative terminals.
- **Framework policy:** use common xterm profile, then probe proprietary/media support only if needed.

## IX.8 Windows Terminal Profiles

### IX.8.1 Windows Console Host (`conhost.exe`)

- **Identity:** classic Windows console host; not the same as Windows Terminal.
- **Lineage:** WINDOWS + partial ECMA-48/VT emulation when VT processing is enabled.
- **Traditional model:** Win32 Console API, not POSIX PTY byte stream.
- **VT output:** requires `ENABLE_VIRTUAL_TERMINAL_PROCESSING` on suitable handles.
- **VT input:** requires appropriate input mode such as `ENABLE_VIRTUAL_TERMINAL_INPUT`.
- **Core:** cursor, SGR, erase, scrolling margins, and input sequences are supported to varying degrees in modern Windows.
- **Graphics:** no reliable Kitty graphics/Sixel baseline.
- **OSC:** limited compared to xterm-family terminals.
- **Framework policy:** on Windows, separate `ConsoleBackend` from `PtyBackend`. Enable VT modes explicitly; provide Console API fallback if necessary.

### IX.8.2 ConPTY

- **Identity:** Windows pseudo console infrastructure.
- **Role:** bridge between console applications and terminal frontends.
- **Lineage:** WINDOWS transport, not a terminal emulator by itself.
- **Important caveat:** ConPTY may transform, synthesize, or block sequences. Some advanced DCS/APC/OSC passthrough use cases can be affected.
- **Framework policy:** detect both the app’s inside view and the outer frontend. Do not assume that a protocol supported by Windows Terminal is transparently delivered through every ConPTY path.

### IX.8.3 Windows Terminal

- **Identity:** `WT_SESSION` environment variable; ConPTY transport for local console apps.
- **Lineage:** WINDOWS + xterm-compatible VT frontend.
- **Core:** ECMA-48/VT output, truecolor, SGR, cursor, alternate screen, mouse, bracketed paste, OSC 8 in modern versions.
- **OSC 52:** policy and version dependent; always probe or require user opt-in.
- **Images:** Sixel and iTerm2/Kitty graphics support have changed over time and should be treated as version-dependent.
- **Keyboard:** enhanced keyboard support evolves; rely on probes.
- **Framework policy:** Modern text profile on Windows. Use conservative rich features unless confirmed by probe.

### IX.8.4 mintty

- **Identity:** common in Cygwin, MSYS2, Git for Windows.
- **Lineage:** xterm-like terminal on Windows, not ConPTY-first for Unix-like programs.
- **Core:** strong xterm-compatible behavior, truecolor, mouse, bracketed paste, OSC 8, OSC 52 depending policy.
- **Graphics:** Sixel and iTerm2-like image behavior may be supported depending version.
- **Framework policy:** treat as xterm-modern. Use terminfo and probe images/clipboard.

### IX.8.5 PuTTY / KiTTY

- **Identity:** SSH/Telnet client with its own terminal emulator.
- **Lineage:** DEC/xterm-inspired, but independent implementation.
- **Core:** supports common VT sequences, colors, mouse modes depending settings.
- **OSC 52:** may be disabled or limited by settings.
- **Images:** no Kitty graphics or iTerm2 baseline.
- **Keyboard:** function-key and modifier behavior depends heavily on settings.
- **Framework policy:** conservative xterm-like profile. Let users override keyboard/mouse behavior.

### IX.8.6 ConEmu / cmder

- **Identity:** `ConEmuANSI`, `ConEmuPID`, etc.
- **Lineage:** WINDOWS console wrapper plus ConEmu-specific extensions.
- **Core:** ANSI/VT support varies by mode and hosted shell.
- **Extensions:** ConEmu-specific OSC-like or ANSI features exist; not portable.
- **Framework policy:** use Windows/VT fallback profile; avoid ConEmu-specific behavior unless user explicitly targets it.

## IX.9 Browser and Embedded Terminal Profiles

### IX.9.1 xterm.js

- **Identity:** JavaScript terminal parser/rendering library used by many web IDEs.
- **Lineage:** WEB + xterm-compatible parser model.
- **Core:** supports many C0, C1, ESC, CSI, DCS, and OSC sequence categories, but not every xterm sequence.
- **Security:** browser host decides which OSC/DCS actions are permitted.
- **OSC 52:** usually host-policy-gated or addon-dependent.
- **Images:** Sixel/Kitty/iTerm2 image protocols are not a safe baseline; addons/integrations may implement them.
- **Mouse:** SGR mouse and common modes are often supported.
- **Shell marks:** VS Code and other hosts may add OSC 633/133 handling.
- **Framework policy:** detect browser host. Use xterm.js as a parser profile but defer privileged actions to host capabilities.

### IX.9.2 VS Code Integrated Terminal

- **Identity:** `TERM_PROGRAM=vscode` in many shells.
- **Lineage:** xterm.js + VSCODE extensions.
- **Core:** xterm-like rendering, truecolor, bracketed paste, mouse, OSC 8, shell integration.
- **OSC 633:** VS Code shell integration uses OSC 633 for prompt start/end, command pre-execution/completion, command line metadata, properties, etc.
- **OSC 52:** policy-gated.
- **Images:** not a standard baseline; host/integrations may add support.
- **Framework policy:** Modern text profile. If writing shell integration, support OSC 633 and OSC 133. If writing TUI app, avoid VS Code-specific controls unless opt-in.

### IX.9.3 hterm / ChromeOS Secure Shell

- **Identity:** browser/extension-based terminal.
- **Lineage:** WEB + xterm-compatible subset.
- **Core:** common ANSI/VT sequences, colors, mouse, bracketed paste.
- **Security:** OSC 52 and hyperlinks are policy controlled.
- **Images:** not a baseline.
- **Framework policy:** conservative web-terminal profile.

### IX.9.4 Jupyter / Notebook / Web REPL Terminals

- **Identity:** pseudo-terminal embedded in a web app.
- **Lineage:** WEB; often xterm.js or similar.
- **Transport:** may not be a full raw PTY; input/output can be mediated by kernels, gateways, or subprocess wrappers.
- **Resize:** may be synthetic.
- **Clipboard/images:** web app policy, not terminal protocol alone.
- **Framework policy:** assume partial xterm.js. Provide non-interactive fallback and avoid unbounded probes.

## IX.10 Multiplexer Profiles

### IX.10.1 tmux

- **Identity:** `TMUX` variable set; inside `$TERM` often `screen`, `screen-256color`, `tmux`, or `tmux-256color`.
- **Lineage:** MULTIPLEXER + own terminfo + proxy for outer terminal.
- **Role:** tmux is both a terminal emulator for applications inside panes and a terminal application for the outer terminal.
- **Core:** supports common TUI needs: cursor, SGR, alternate screen, mouse, bracketed paste, truecolor when configured.
- **Truecolor:** requires correct terminfo/terminal-features configuration in many setups.
- **OSC 52:** supported/passed depending settings.
- **Sixel/images:** pass-through support is version/config-dependent; Sixel has better multiplexer history than Kitty graphics in some environments.
- **Kitty graphics:** requires pass-through or tmux-aware protocol handling; do not assume.
- **Kitty keyboard:** support and passthrough are evolving. Use probes and restore modes carefully.
- **Framework policy:** create a two-layer profile: `inside=tmux`, `outside=$TERM outside tmux`. Never trust only `$TERM` inside tmux.

### IX.10.2 GNU screen

- **Identity:** `STY` variable set; `$TERM` often `screen` or `screen-256color`.
- **Lineage:** MULTIPLEXER, older than tmux.
- **Core:** basic TUI features work.
- **Truecolor:** often poor unless patched/configured; many deployments are limited.
- **OSC 8/52:** often stripped or not passed.
- **Images:** generally not reliable.
- **Keyboard:** enhanced keyboard protocols not reliable.
- **Framework policy:** conservative profile. Disable rich protocols by default. Prefer simple ANSI/SGR rendering.

### IX.10.3 Zellij

- **Identity:** Zellij-specific environment variables in some setups; Rust multiplexer.
- **Lineage:** MULTIPLEXER + modern protocol translation goals.
- **Core:** modern TUI multiplexer with mouse, truecolor, clipboard-related features depending environment.
- **Kitty keyboard/graphics:** support is evolving and version-dependent; strict probe and fallback are mandatory.
- **Framework policy:** treat as dynamic multiplexer. Feature support must be tested per version and user configuration.

### IX.10.4 WezTerm Mux

- **Identity:** WezTerm mux domains; local/remote panes.
- **Lineage:** MULTIPLEXER integrated into a terminal emulator.
- **Core:** can preserve more features than older multiplexers because the terminal and mux share design goals.
- **Caveat:** remote domains and SSH change what the application can see.
- **Framework policy:** detect both `WEZTERM_*` and transport/mux context.

### IX.10.5 dvtm / abduco / byobu

- **Identity:** lightweight multiplexers/wrappers.
- **Lineage:** MULTIPLEXER or wrapper around terminal/session behavior.
- **Core:** usually terminfo-driven.
- **Rich protocols:** not reliable unless explicitly documented.
- **Framework policy:** conservative unless the real outer terminal can be detected and passthrough is known.

## IX.11 Image and Graphics Support by Terminal Family

### IX.11.1 Recommended Image Selection Algorithm

A TUI framework should choose graphics in this order:

1. **Explicit user override**: `--graphics=kitty|sixel|iterm2|unicode|none`.
2. **Inside multiplexer?** If yes, check passthrough and known mux support first.
3. **Kitty graphics** if the terminal responds correctly to a Kitty graphics query and the environment is not blocking DCS/APC-like payloads.
4. **Sixel** if DA/terminfo/probe confirms Sixel and the app can tolerate cell-grid/palette constraints.
5. **iTerm2 inline images** if iTerm2 or compatible terminal is detected and the protocol is not blocked.
6. **Unicode fallback** using block, half-block, quadrant, Braille, or shade glyphs.
7. **Text-only fallback**.

### IX.11.2 Terminal Graphics Matrix

| Terminal             |                 Sixel | Kitty Graphics | iTerm2 Images | ReGIS/Tektronix | Unicode Fallback | Preferred Framework Path                                              |
| -------------------- | --------------------: | -------------: | ------------: | --------------: | ---------------: | --------------------------------------------------------------------- |
| xterm                |                     G |              X |             X |             G/P |                N | Sixel if enabled, otherwise Unicode.                                  |
| mlterm               |                   N/G |              X |             X |               P |                N | Sixel.                                                                |
| foot                 |                     N |              X |             X |               X |                N | Sixel.                                                                |
| Kitty                |                     X |              N |           P/C |               X |                N | Kitty graphics.                                                       |
| Ghostty              |                   X/P |              N |           P/? |               X |                N | Kitty graphics.                                                       |
| WezTerm              |                   G/P |            P/? |           N/C |             X/P |                N | Probe: iTerm2 image or Kitty graphics; Sixel if enabled.              |
| iTerm2               |                   P/? |            P/? |             N |               X |                N | iTerm2 image protocol.                                                |
| Konsole              | G/N depending version |            P/? |           X/P |             X/P |                N | Probe Sixel first unless Kitty graphics confirmed.                    |
| Windows Terminal     |                   P/? |            X/P |           P/? |               X |                N | Probe; otherwise Unicode.                                             |
| Alacritty            |                     X |            X/P |             X |               X |                N | Unicode fallback unless feature becomes available and probe confirms. |
| VTE / GNOME Terminal |                   X/P |              X |             X |               X |                N | Unicode fallback; Sixel only if distribution/version confirms.        |
| tmux                 |               Proxy/G |        Proxy/G |       Proxy/G |           Proxy |                N | Prefer Sixel if passthrough; otherwise Unicode.                       |
| screen               |                   X/P |              X |             X |               X |                N | Unicode/text.                                                         |
| xterm.js             |                 Addon |          Addon |         Addon |               X |                N | Host-specific addon; otherwise Unicode.                               |

### IX.11.3 Why Image Support Cannot Be Static

Image protocols are among the least stable capability areas because:

- Some protocols require large string payloads, which multiplexers may strip.
- Some protocols require filesystem access by the terminal emulator, which is dangerous over SSH and must be restricted.
- Browser terminals cannot freely read local files from escape sequences.
- Some image protocols are intentionally not implemented by certain maintainers.
- User settings may disable image display.
- `TERM` names usually do not encode image support accurately.

## IX.12 Keyboard Support by Terminal Family

### IX.12.1 Keyboard Protocol Selection

Preferred order:

1. **Kitty keyboard protocol** with query/push/pop if supported.
2. **CSI-u / modifyOtherKeys mode** if Kitty protocol is unavailable but enhanced key encoding is supported.
3. **xterm legacy modified special-key sequences** for arrows, function keys, Home/End, etc.
4. **Alt-as-ESC legacy model** with timeout disambiguation.
5. **Plain bytes / Unicode text input**.

### IX.12.2 Terminal Keyboard Matrix

| Terminal         | Legacy Keys | App Cursor / Keypad | xterm Modified Keys | modifyOtherKeys |   CSI-u | Kitty Keyboard | Release/Repeat Events | Associated Text | Policy                                |
| ---------------- | ----------: | ------------------: | ------------------: | --------------: | ------: | -------------: | --------------------: | --------------: | ------------------------------------- |
| xterm            |           N |                   N |                   N |               N |       P |              X |                     X |               X | Use modifyOtherKeys if needed.        |
| Kitty            |           N |                   N |                   C |             N/C |       N |              N |                     N |               N | Use Kitty keyboard with push/pop.     |
| WezTerm          |           N |                   N |                   C |               G |       G |            G/N |                   G/N |             G/N | Probe and respect config.             |
| Ghostty          |           N |                   N |                   C |               P |       N |              N |                     N |               N | Use Kitty keyboard if query succeeds. |
| Alacritty        |           N |                   N |                   C |               P |     P/N |            P/N |                   P/? |             P/? | Probe; avoid assuming full stack.     |
| foot             |           N |                   N |                   C |               P |     P/N |            P/N |                   P/? |             P/? | Probe.                                |
| iTerm2           |           N |                   N |                   C |               P |       P |              P |                   P/? |             P/? | Probe; may support only subsets.      |
| VTE              |           N |                   N |                   C |             P/X |     P/X |            X/P |                     X |               X | Use legacy/xterm path.                |
| Windows Terminal |           N |                   N |                 C/P |             P/? |     P/? |            P/? |                   P/? |             P/? | Use Windows/VT input mode and probe.  |
| Terminal.app     |           N |                   N |                 P/C |             X/P |     X/P |              X |                     X |               X | Conservative.                         |
| tmux             |       Proxy |               Proxy |               Proxy |         Proxy/P | Proxy/P |        Proxy/P |               Proxy/P |         Proxy/P | Use tmux-aware negotiation.           |
| screen           |       Proxy |               Proxy |                   P |             X/P |       X |              X |                     X |               X | Conservative.                         |
| xterm.js         |           N |                   N |                 P/C |             P/X |     P/X |            X/P |                   X/P |             X/P | Host-specific.                        |

### IX.12.3 Framework Keyboard Rules

- Never enable an enhanced keyboard protocol without a restore path.
- Use a timeout only for legacy `ESC` vs `Alt` ambiguity; do not use timeouts to parse CSI/DCS/OSC strings if a proper parser can be used.
- Normalize events into semantic and physical layers:
  - `Key::Character("a")`
  - `Key::Named(Escape)`
  - `Key::Physical(Code::KeyA)` when available
  - modifiers as independent flags
  - text payload as a separate field
- Distinguish key press, release, repeat only when the protocol actually reports them.
- Preserve raw sequence diagnostics for debugging.

## IX.13 Mouse Support by Terminal Family

### IX.13.1 Mouse Protocol Selection

Preferred order:

1. **SGR mouse (`DECSET 1006`)**.
2. **Button-event mouse (`1002`) or all-motion (`1003`)** when needed.
3. **Normal tracking (`1000`)** as fallback.
4. **X10 (`9`)** only for very old compatibility.
5. **Pixel mouse (`1016`)** only when precise position is required and probed.
6. **No mouse** fallback with keyboard-accessible UI.

### IX.13.2 Mouse Matrix

| Terminal         |   X10 | Normal 1000 | Button 1002 | Any 1003 | SGR 1006 | urxvt 1015 |   UTF-8 1005 | Pixel 1016 | Policy                                |
| ---------------- | ----: | ----------: | ----------: | -------: | -------: | ---------: | -----------: | ---------: | ------------------------------------- |
| xterm            |     N |           N |           N |        N |        N |          P | P/deprecated |        G/N | SGR default.                          |
| Kitty            |     C |           C |           C |        C |        N |        P/C |          X/P |          N | SGR; pixel if needed.                 |
| WezTerm          |     C |           C |           C |        C |        N |          P |          X/P |        P/N | SGR.                                  |
| Ghostty          |     C |           C |           C |        C |        N |        P/? |          X/P |        P/N | SGR.                                  |
| Alacritty        |     C |           C |           C |        C |        N |        P/? |          X/P |        P/? | SGR.                                  |
| foot             |     C |           C |           C |        C |        N |        P/? |          X/P |        P/? | SGR.                                  |
| iTerm2           |     C |           C |           C |        C |        N |          P |          X/P |        P/? | SGR.                                  |
| VTE              |     C |           C |           C |        C |        N |        P/? |          X/P |        P/? | SGR.                                  |
| Windows Terminal |     P |           C |           C |        C |      C/N |        X/P |            X |        P/? | SGR if available.                     |
| tmux             | Proxy |       Proxy |       Proxy |    Proxy |    Proxy |    Proxy/P |          X/P |    Proxy/P | Enable mouse in tmux and probe outer. |
| screen           |     P |           P |           P |        P |        P |        X/P |            X |          X | Conservative.                         |
| xterm.js         |     C |           C |           C |        C |        C |        P/X |          X/P |        X/P | SGR in browser.                       |

## IX.14 OSC, DCS, and Shell Integration by Terminal Family

### IX.14.1 OSC Families

| OSC              | Family                  | Common Use                   | Risk                                  |
| ---------------- | ----------------------- | ---------------------------- | ------------------------------------- |
| OSC 0/1/2        | xterm                   | window/icon title            | low/medium: can spoof title           |
| OSC 4            | xterm                   | palette query/set            | medium: visual spoofing               |
| OSC 7            | VTE/iTerm2/etc.         | current directory            | medium: path leakage                  |
| OSC 8            | xterm/VTE/iTerm2        | hyperlinks                   | medium/high: phishing if untrusted    |
| OSC 9 / 777 / 99 | vendor-specific         | notifications                | medium: spam/spoofing                 |
| OSC 10/11/12     | xterm                   | fg/bg/cursor color           | medium                                |
| OSC 52           | xterm                   | clipboard                    | high: data exfiltration/injection     |
| OSC 133          | FinalTerm/iTerm2/modern | semantic prompt marks        | low/medium                            |
| OSC 633          | VS Code                 | shell integration            | low/medium                            |
| OSC 666          | VTE                     | term properties              | medium                                |
| OSC 1337         | iTerm2                  | images, files, variables, UI | high: file/image/clipboard/UI effects |
| OSC 30001/30101  | Kitty                   | color stack                  | medium                                |

### IX.14.2 DCS Families

| DCS              | Family    | Common Use                      | Risk                                               |
| ---------------- | --------- | ------------------------------- | -------------------------------------------------- |
| DECRQSS          | DEC/xterm | request status string           | low/medium                                         |
| XTGETTCAP        | xterm     | query terminfo capabilities     | medium: information disclosure                     |
| XTSETTCAP        | xterm     | set terminfo data               | high if accepted without policy                    |
| Sixel            | DEC       | raster image data               | medium/high: large payloads                        |
| tmux passthrough | tmux      | pass sequence to outer terminal | high: bypasses multiplexer policy if misconfigured |

### IX.14.3 Shell Integration Matrix

| Terminal       |        OSC 133 |        OSC 633 |       OSC 1337 |          OSC 7 | Notes                                            |
| -------------- | -------------: | -------------: | -------------: | -------------: | ------------------------------------------------ |
| iTerm2         |              N |            P/C |              N |              N | Rich shell integration and proprietary commands. |
| VS Code        |            P/C |              N |            X/P |              C | OSC 633 is primary.                              |
| Kitty          |              C |            C/P |            P/X |              C | Has own shell integration too.                   |
| WezTerm        |              C |            C/P |            C/P |              C | Supports several ecosystems.                     |
| Ghostty        |              C |            C/P |            P/? |              C | Modern semantic prompt support.                  |
| VTE            |            P/C |            X/P |              X |            N/C | VTE-style current-directory integration.         |
| Terminal.app   |            P/? |              X |              X |              P | Conservative.                                    |
| xterm.js hosts | Host-dependent | Host-dependent | Host-dependent | Host-dependent | Depends on host application.                     |

## IX.15 `terminfo` Names and Environment Identity

### IX.15.1 Common TERM Values

| TERM                           | Typical Meaning                        | Warning                                                                 |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------- |
| `xterm`                        | xterm-like terminal                    | Usually too vague; may lack 256-color info.                             |
| `xterm-256color`               | common modern xterm-like fallback      | Does not imply OSC 8, OSC 52, Kitty graphics, Sixel, or Kitty keyboard. |
| `xterm-kitty`                  | Kitty terminfo                         | Strong Kitty hint, but remote/mux can interfere.                        |
| `wezterm` / `wezterm-256color` | WezTerm-specific terminfo              | Requires terminfo installed on remote host.                             |
| `alacritty`                    | Alacritty-specific terminfo            | Requires terminfo installed.                                            |
| `foot` / `foot-extra`          | foot-specific terminfo                 | `foot-extra` may advertise more.                                        |
| `screen` / `screen-256color`   | inside GNU screen or tmux older config | Outer terminal hidden.                                                  |
| `tmux` / `tmux-256color`       | inside tmux modern config              | Use tmux-specific feature discovery.                                    |
| `linux`                        | Linux virtual console                  | Conservative feature set.                                               |
| `vt100` / `vt220`              | legacy compatibility                   | Do not use modern features.                                             |
| `ansi`                         | vague ANSI subset                      | Treat conservatively.                                                   |
| `dumb`                         | no cursor-addressable terminal         | Avoid full-screen TUI.                                                  |

### IX.15.2 Environment Variables Worth Reading

| Variable                                   | Meaning                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `TERM`                                     | terminfo entry name, not exact terminal identity.                |
| `COLORTERM`                                | often `truecolor` or `24bit`, but not standardized.              |
| `TERM_PROGRAM`                             | terminal app hint on macOS/VS Code/etc.                          |
| `TERM_PROGRAM_VERSION`                     | app version hint.                                                |
| `VTE_VERSION`                              | VTE-based terminal hint.                                         |
| `WT_SESSION`                               | Windows Terminal session hint.                                   |
| `KITTY_WINDOW_ID`, `KITTY_PID`             | Kitty session hints.                                             |
| `WEZTERM_PANE`, `WEZTERM_EXECUTABLE`, etc. | WezTerm hints.                                                   |
| `ALACRITTY_WINDOW_ID`                      | Alacritty hint.                                                  |
| `KONSOLE_VERSION`                          | Konsole hint.                                                    |
| `TMUX`                                     | inside tmux.                                                     |
| `STY`                                      | inside GNU screen.                                               |
| `ZELLIJ`                                   | inside Zellij if set.                                            |
| `SSH_TTY`, `SSH_CONNECTION`                | remote transport; local terminal may differ from remote process. |
| `NO_COLOR`                                 | user requests no color.                                          |
| `CLICOLOR`, `CLICOLOR_FORCE`               | common color conventions.                                        |
| `TERM_FEATURES`                            | emerging feature-reporting idea used by some environments.       |

### IX.15.3 Precedence Rules

1. User override beats everything.
2. Safety policy beats feature detection.
3. Runtime positive probe beats environment guess.
4. Multiplexer identity modifies or overrides outer terminal profile.
5. `terminfo` gives historical text capabilities, not modern rich protocol truth.
6. `$TERM=xterm-256color` is not enough to enable images, clipboard, or enhanced keyboard.

## IX.16 Per-Terminal Framework Defaults

### IX.16.1 Defaults Table

| Profile            | Color       | Mouse        | Keyboard            | Images                   | Clipboard    | Hyperlinks      | Renderer                         |
| ------------------ | ----------- | ------------ | ------------------- | ------------------------ | ------------ | --------------- | -------------------------------- |
| `dumb`             | none        | off          | bytes only          | none                     | off          | off             | line-mode                        |
| `vt100`            | mono        | off          | legacy              | none                     | off          | off             | full-screen minimal              |
| `linux-console`    | 16-color    | off/gpm      | legacy              | none                     | off          | off             | conservative                     |
| `xterm-basic`      | 256-color   | SGR if probe | legacy + xterm mods | none/Sixel probe         | OSC52 opt-in | OSC8 probe      | differential                     |
| `vte-modern`       | truecolor   | SGR          | legacy/xterm        | unicode fallback         | opt-in       | on if probe     | differential                     |
| `iterm2-rich`      | truecolor   | SGR          | probe CSI-u/Kitty   | iTerm2 images            | policy-gated | on              | differential/sync if available   |
| `kitty-rich`       | truecolor   | SGR/pixel    | Kitty keyboard      | Kitty graphics           | policy-gated | on              | synchronized output              |
| `wezterm-rich`     | truecolor   | SGR          | probe Kitty/CSI-u   | probe iTerm2/Kitty/Sixel | policy-gated | on              | synchronized output if confirmed |
| `ghostty-rich`     | truecolor   | SGR          | Kitty keyboard      | Kitty graphics           | policy-gated | on              | synchronized output if confirmed |
| `alacritty-modern` | truecolor   | SGR          | probe CSI-u         | unicode fallback         | policy-gated | on if probe     | differential                     |
| `foot-rich`        | truecolor   | SGR          | probe CSI-u/Kitty   | Sixel                    | policy-gated | on              | differential                     |
| `windows-terminal` | truecolor   | SGR/probe    | Windows VT/probe    | probe/unicode            | policy-gated | on if supported | differential                     |
| `tmux`             | inherited   | tmux mouse   | tmux-aware          | passthrough/probe        | tmux policy  | tmux policy     | differential                     |
| `screen`           | 256/limited | limited      | legacy              | none                     | off          | off/probe       | conservative                     |
| `xtermjs-hosted`   | truecolor   | SGR          | host-limited        | addon/unicode            | host policy  | host policy     | differential                     |

### IX.16.2 Exit Cleanup by Profile

Always restore:

- cursor visibility: `CSI ? 25 h`
- mouse modes: disable `1000`, `1002`, `1003`, `1006`, `1015`, `1016`
- bracketed paste: `CSI ? 2004 l`
- focus tracking: `CSI ? 1004 l`
- alternate screen: `CSI ? 1049 l` if enabled
- synchronized output: `CSI ? 2026 l` if enabled
- Kitty keyboard stack: pop to previous state if pushed
- style: `SGR 0`
- application cursor/keypad modes: restore if changed

## IX.17 Feature-Probe Recipes per Terminal Class

### IX.17.1 Safe Probe Budget

A TUI framework should not blast every terminal with every probe. Use a staged budget:

1. **Stage 0:** read environment variables and `terminfo`.
2. **Stage 1:** cheap non-mutating queries: DA1, DA2, DSR 6, color queries if policy allows.
3. **Stage 2:** feature-specific probes only when the application needs that feature.
4. **Stage 3:** destructive or privileged features only with user opt-in: clipboard read, file transfer, local-file image loading.

### IX.17.2 Recommended Probes

| Feature             | Probe                                    | Notes                                                      |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Cursor position     | `CSI 6 n`                                | Must parse response safely and time out.                   |
| Primary DA          | `CSI c`                                  | Hints only.                                                |
| Secondary DA        | `CSI > c`                                | Hints xterm/VT lineage.                                    |
| Kitty keyboard      | Kitty query sequence                     | Use exact spec and stack semantics.                        |
| SGR mouse           | Enable and test only when interactive    | Requires actual mouse event or synthetic test environment. |
| Bracketed paste     | Usually safe to enable                   | Restore on exit.                                           |
| OSC 8               | No reliable universal probe              | Use allowlist/profile or test visually.                    |
| OSC 52              | Avoid read probes by default             | Clipboard access is high-risk.                             |
| Sixel               | DA1 sixel code or controlled DCS test    | Beware multiplexer stripping.                              |
| Kitty graphics      | Kitty graphics query                     | Must handle `OK`/error response and timeouts.              |
| iTerm2 images       | identity + optional test                 | No universal cross-terminal query.                         |
| Synchronized output | enable around frame only if known/probed | Restore even on panic/crash.                               |

## IX.18 Known False Assumptions

1. **`xterm-256color` does not mean xterm.** It is often a generic compatibility value.
2. **`TERM` does not describe images.** Image protocols require probes or terminal-specific identity.
3. **Truecolor is not guaranteed by `256color`.** Use `COLORTERM`, terminfo extensions, or probes.
4. **OSC 52 support is not the same as OSC 52 permission.** Many terminals gate clipboard access.
5. **Kitty keyboard is not the same as CSI-u-looking sequences.** Some terminals implement only a subset.
6. **Sixel support does not imply good image performance.** Palette, size, scrollback, and multiplexer behavior matter.
7. **Running inside tmux changes everything.** You are talking to tmux first, not directly to the outer terminal.
8. **Windows Terminal support is not only Windows Terminal.** ConPTY and the application’s console mode matter.
9. **Browser terminals are host applications.** xterm.js parser support does not imply host permission to use a feature.
10. **Unknown escape sequences can be dangerous.** Sanitize logs and untrusted terminal output.

## IX.19 Minimal Per-Terminal JSON Seed Database

A framework can ship a seed database like this, then override it with runtime probes:

```json
{
  "xterm": {
    "lineage": ["FORMAL", "DEC", "XTERM"],
    "default_term_names": ["xterm", "xterm-256color"],
    "safe_defaults": ["sgr", "256color", "alt_screen", "bracketed_paste", "sgr_mouse"],
    "probe_before_use": ["truecolor", "osc52", "osc8", "sixel", "modifyOtherKeys"]
  },
  "kitty": {
    "lineage": ["FORMAL", "DEC", "XTERM", "KITTY"],
    "default_term_names": ["xterm-kitty"],
    "env_hints": ["KITTY_WINDOW_ID", "KITTY_PID"],
    "safe_defaults": ["truecolor", "osc8", "bracketed_paste", "focus", "sgr_mouse"],
    "probe_before_use": ["kitty_keyboard", "kitty_graphics", "osc52"]
  },
  "iterm2": {
    "lineage": ["FORMAL", "DEC", "XTERM", "ITERM2", "FINALTERM"],
    "env_hints": ["TERM_PROGRAM=iTerm.app", "LC_TERMINAL=iTerm2"],
    "safe_defaults": ["truecolor", "osc8", "bracketed_paste", "focus", "sgr_mouse"],
    "probe_before_use": ["osc52", "iterm2_images", "enhanced_keyboard"]
  },
  "wezterm": {
    "lineage": ["FORMAL", "DEC", "XTERM", "ITERM2", "KITTY", "MULTIPLEXER"],
    "env_hints": ["WEZTERM_PANE", "WEZTERM_EXECUTABLE"],
    "safe_defaults": ["truecolor", "osc8", "bracketed_paste", "focus", "sgr_mouse"],
    "probe_before_use": ["kitty_keyboard", "kitty_graphics", "iterm2_images", "sixel", "osc52"]
  },
  "ghostty": {
    "lineage": ["FORMAL", "DEC", "XTERM", "KITTY"],
    "safe_defaults": ["truecolor", "osc8", "bracketed_paste", "focus", "sgr_mouse"],
    "probe_before_use": ["kitty_keyboard", "kitty_graphics", "osc52"]
  },
  "alacritty": {
    "lineage": ["FORMAL", "DEC", "XTERM"],
    "default_term_names": ["alacritty", "xterm-256color"],
    "env_hints": ["ALACRITTY_WINDOW_ID"],
    "safe_defaults": ["truecolor", "osc8_if_known", "bracketed_paste", "focus", "sgr_mouse"],
    "probe_before_use": ["enhanced_keyboard", "osc52", "images"]
  },
  "foot": {
    "lineage": ["FORMAL", "DEC", "XTERM"],
    "default_term_names": ["foot", "foot-extra"],
    "safe_defaults": ["truecolor", "osc8", "bracketed_paste", "focus", "sgr_mouse"],
    "probe_before_use": ["sixel", "enhanced_keyboard", "osc52"]
  },
  "windows_terminal": {
    "lineage": ["WINDOWS", "FORMAL", "DEC", "XTERM"],
    "env_hints": ["WT_SESSION"],
    "safe_defaults": ["truecolor", "bracketed_paste", "sgr_mouse_if_vt_input"],
    "probe_before_use": ["osc8", "osc52", "images", "enhanced_keyboard"]
  },
  "tmux": {
    "lineage": ["MULTIPLEXER"],
    "env_hints": ["TMUX"],
    "safe_defaults": ["alt_screen", "bracketed_paste", "mouse_if_enabled"],
    "probe_before_use": [
      "truecolor",
      "osc52",
      "osc8",
      "sixel_passthrough",
      "kitty_graphics_passthrough",
      "kitty_keyboard"
    ]
  },
  "screen": {
    "lineage": ["MULTIPLEXER"],
    "env_hints": ["STY"],
    "safe_defaults": ["basic_sgr", "alt_screen"],
    "probe_before_use": ["256color", "mouse", "clipboard", "hyperlinks"]
  },
  "xtermjs": {
    "lineage": ["WEB", "XTERM"],
    "safe_defaults": ["truecolor", "bracketed_paste", "sgr_mouse"],
    "probe_before_use": ["osc52", "osc8", "images", "shell_integration"]
  }
}
```

## IX.20 What “Different Standards for Each Terminal” Really Means

A terminal rarely implements exactly one standard. A real terminal is usually a stack:

```text
Terminal = formal grammar + historical emulation target + xterm behavior + vendor extensions + user configuration + transport/multiplexer constraints
```

Examples:

- **xterm** = ECMA-48 + DEC VT + xterm extensions + optional Sixel/Tektronix.
- **Kitty** = ECMA-48 + DEC/xterm compatibility + Kitty keyboard + Kitty graphics + Kitty OSC extensions.
- **iTerm2** = ECMA-48 + DEC/xterm compatibility + iTerm2 OSC 1337 + FinalTerm shell marks.
- **WezTerm** = ECMA-48 + DEC/xterm compatibility + selected Kitty/iTerm2 features + built-in multiplexer.
- **Windows Terminal** = Windows ConPTY + VT parser + xterm-like behavior + Windows policy.
- **VS Code terminal** = xterm.js + VS Code host policy + OSC 633 shell integration.
- **tmux** = terminal emulator inside + terminal application outside + translation/passthrough policy.

Therefore, a TUI framework should not ask: “Which terminal is this?” only. It should ask:

1. What byte-stream grammar can I use?
2. What screen model is implemented?
3. What text rendering and Unicode width model should I assume?
4. What input protocol is currently enabled?
5. What graphics protocol, if any, is safe?
6. What OSC/DCS operations are allowed by policy?
7. Am I behind a multiplexer, SSH, ConPTY, or browser host?
8. What do runtime probes confirm?
9. What has the user explicitly configured?

## IX.21 References for This Appendix

Primary and near-primary references to keep beside the profile database:

- ECMA-48 / ISO 6429 — control functions for coded character sets.
- xterm `ctlseqs` — de facto reference for DEC/xterm terminal control behavior.
- XTerm FAQ and `terminfo` entries — practical compatibility details.
- ncurses `terminfo(5)` — capability database semantics.
- Kitty keyboard protocol specification.
- Kitty graphics protocol specification.
- iTerm2 proprietary escape codes and inline images documentation.
- Microsoft Console Virtual Terminal Sequences and ConPTY documentation.
- xterm.js supported terminal sequences.
- foot `foot-ctlseqs(7)`.
- WezTerm escape sequence documentation.
- Ghostty feature and terminal-protocol documentation.
- tmux manual and FAQ.
- GNU screen manual.
- Unicode Standard Annex #11 and grapheme cluster rules.
- Terminfo.dev standards, features, terminal pages, and comparison matrix.
