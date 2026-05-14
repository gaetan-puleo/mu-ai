import { Box, render, Text, useApp, useInput } from 'ink';
import {
  type Channel,
  type ChannelContext,
  type Command,
  debugLog,
  type Message,
  Mu,
  newMessage,
  type Plugin,
  type SessionEvent,
} from 'mu-core';
import { type ApiModel, createOpenAIProviderPlugin, listModels } from 'mu-openai-provider';
import React from 'react';
import {
  type DropdownItem,
  MessagesViewport,
  PromptInput,
  Screen,
  Spinner,
  StatusBar,
  type ViewportRow,
} from './tui/primitives';
import { drainStdin } from './tui/stdin-drain';

const { useEffect, useMemo, useRef, useState } = React;

interface PickerProps {
  baseUrl: string;
  onPick: (modelId: string) => void;
  onAbort: () => void;
}

function ModelPicker({ baseUrl, onPick, onAbort }: PickerProps): React.ReactElement {
  const [models, setModels] = useState<ApiModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    listModels(baseUrl)
      .then(setModels)
      .catch((err) => setError(err.message ?? String(err)));
  }, [baseUrl]);

  useInput((input, key) => {
    if (!models || models.length === 0) return;
    if (key.upArrow) setCursor((c) => (c - 1 + models.length) % models.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % models.length);
    else if (key.return) {
      const chosen = models[cursor];
      if (chosen) onPick(chosen.id);
    } else if (key.escape || input === 'q') onAbort();
  });

  if (error) return <Text color="red">Failed to list models: {error}</Text>;
  if (!models) return <Text dimColor={true}>Loading models from {baseUrl}…</Text>;
  if (models.length === 0) return <Text color="yellow">No models available at {baseUrl}</Text>;

  return (
    <Box flexDirection="column">
      <Text bold={true}>Select a model (↑/↓, enter):</Text>
      {models.map((m, i) => (
        <Text key={m.id} color={i === cursor ? 'cyan' : undefined}>
          {i === cursor ? '› ' : '  '}
          {m.id}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Run an Ink-based model picker BEFORE Mu.start() so we can hand the chosen
 * model id into the provider config. Resolves with `null` if the user aborts
 * (q / esc) before picking.
 */
async function pickModelInteractive(baseUrl: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let picked = false;
    const { unmount, waitUntilExit } = render(
      <Screen>
        <ModelPicker
          baseUrl={baseUrl}
          onPick={(id) => {
            picked = true;
            unmount();
            resolve(id);
          }}
          onAbort={() => {
            unmount();
            resolve(null);
          }}
        />
      </Screen>,
    );
    // If Ink exits for any other reason (e.g. SIGINT), resolve cleanly.
    waitUntilExit().then(() => {
      if (!picked) resolve(null);
    });
  });
}

interface ChatProps {
  ctx: ChannelContext;
  model: string;
  onExit: () => void;
}

interface TranscriptRow {
  id: string;
  role: Message['role'];
  content: string;
  reasoning?: string;
}

/**
 * Render a row for a system message (e.g. /help output, command feedback).
 * Kept compact and dim so it's clearly out-of-band.
 */
function transcriptRowFromMessage(message: Message): TranscriptRow | null {
  if (!(message.content || message.reasoning)) return null;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
  };
}

interface CommandPaletteProps {
  items: readonly DropdownItem[];
  cursor: number;
  maxVisible: number;
}

/**
 * Purely presentational palette renderer. Unlike `Dropdown` from `./tui/
 * primitives`, this component does NOT call `useInput` — it relies on the
 * parent `Chat` component to drive the cursor via the same key handler so
 * the `PromptInput` can stay focused while the palette is visible.
 */
function CommandPalette({ items, cursor, maxVisible }: CommandPaletteProps): React.ReactElement {
  let start = 0;
  let end = items.length;
  if (maxVisible > 0 && items.length > maxVisible) {
    const half = Math.floor(maxVisible / 2);
    start = Math.max(0, Math.min(cursor - half, items.length - maxVisible));
    end = start + maxVisible;
  }
  const hiddenAbove = start;
  const hiddenBelow = items.length - end;
  return (
    <Box flexDirection="column">
      {hiddenAbove > 0 ? <Text dimColor={true}>↑ {hiddenAbove} more</Text> : null}
      {items.slice(start, end).map((item, i) => {
        const absolute = start + i;
        const isCursor = absolute === cursor;
        return (
          <Text key={item.id} color={isCursor ? 'cyan' : undefined}>
            {isCursor ? '› ' : '  '}
            {item.label}
          </Text>
        );
      })}
      {hiddenBelow > 0 ? <Text dimColor={true}>↓ {hiddenBelow} more</Text> : null}
    </Box>
  );
}

function Chat({ ctx, model, onExit }: ChatProps): React.ReactElement {
  const session = useMemo(() => ctx.session(), [ctx]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [streaming, setStreaming] = useState<string>('');
  const [streamingReasoning, setStreamingReasoning] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [paletteCursor, setPaletteCursor] = useState(0);
  const idRef = useRef(0);
  const nextId = (): string => `m-${++idRef.current}`;

  // Subscribe to session events so /clear and any plugin-appended system
  // messages (e.g. /help) flow into the transcript through mu-core, not via
  // ad-hoc setState calls in the dispatch path.
  useEffect(() => {
    const off = session.on((ev: SessionEvent) => {
      if (ev.type === 'transcript_cleared') {
        setHistory([]);
      } else if (ev.type === 'message_appended') {
        // We already commit assistant + user messages locally inside submit()
        // for streaming responsiveness. Only mirror system/tool messages that
        // commands may append. Skip ui-only transient duplicates too.
        const m = ev.message;
        if (m.role !== 'system') return;
        const row = transcriptRowFromMessage(m);
        if (!row) return;
        setHistory((h) => [...h, row]);
      }
    });
    return off;
  }, [session]);

  // Compute the palette state up-front so the keyboard handler below can
  // navigate it. We always read straight from mu-core's registry — plugin-
  // contributed commands (e.g. mu-repomap's /repomap) show up automatically.
  const showCommandPalette = !busy && input.startsWith('/');
  const commandQuery = input.slice(1).toLowerCase();
  const allCommands: readonly Command[] = showCommandPalette ? ctx.listCommands() : [];
  const commandItems: DropdownItem[] = showCommandPalette
    ? allCommands
        .filter((c) => c.name.toLowerCase().startsWith(commandQuery))
        .map((c) => ({
          id: `/${c.name}`,
          label: `/${c.name}  ${c.description}`,
        }))
    : [];

  // Clamp the palette cursor whenever the filtered list shrinks (e.g. user
  // narrows the query). Reset to 0 when the palette is hidden.
  useEffect(() => {
    if (!showCommandPalette) {
      if (paletteCursor !== 0) setPaletteCursor(0);
      return;
    }
    if (paletteCursor >= commandItems.length) {
      setPaletteCursor(Math.max(0, commandItems.length - 1));
    }
  }, [showCommandPalette, commandItems.length, paletteCursor]);

  useInput((inputChar, key) => {
    // Ctrl+C: cancel > clear > kill, in priority order.
    //
    // We deliberately do NOT install a `process.on('SIGINT', ...)` handler
    // anywhere in mu-coding. Ink puts stdin in raw mode, so Ctrl+C arrives
    // as a `\x03` keypress (key.ctrl + inputChar==='c') rather than a
    // signal. Handling it here lets the TUI decide what it means.
    //
    // Quit path is `process.exit(0)` — not the graceful onExit() path.
    // Rationale: graceful shutdown can hang on a plugin's deactivate / a
    // keep-alive HTTP socket / an unref'd timer, which forces the user to
    // press Ctrl+C a second time. Ctrl+C means "kill now"; the user
    // already pressed it, that's their intent. /quit and /exit still use
    // the graceful path for non-emergency exits.
    //
    // Note: `render(...)` below passes `exitOnCtrlC: false` so Ink's
    // built-in handler does not preempt this branch.
    if (key.ctrl && inputChar === 'c') {
      if (busy) {
        session.abort();
        return;
      }
      if (input.length > 0) {
        setInput('');
        return;
      }
      process.exit(0);
    }
    if (key.escape && busy) {
      session.abort();
      return;
    }
    // Palette navigation — only when the palette is visible and has items.
    // The PromptInput stays focused throughout so the user can keep typing
    // to narrow the query; we only intercept the dedicated nav keys here.
    if (showCommandPalette && commandItems.length > 0) {
      if (key.upArrow) {
        setPaletteCursor((c) => (c - 1 + commandItems.length) % commandItems.length);
      } else if (key.downArrow || key.tab) {
        setPaletteCursor((c) => (c + 1) % commandItems.length);
      } else if (key.escape) {
        // Clear the slash so the palette closes without submitting.
        setInput('');
      }
    }
  });

  const dispatchCommand = async (text: string): Promise<boolean> => {
    if (!text.startsWith('/')) return false;
    const trimmed = text.slice(1);
    const spaceIdx = trimmed.search(/\s/);
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
    if (!name) return false;
    const cmd = ctx.getCommand(name);
    if (!cmd) {
      await session.append(
        newMessage({
          role: 'system',
          content: `Unknown command: /${name}. Type /help for a list.`,
          meta: { source: 'mu-coding', visibility: 'ui', transient: true },
        }),
      );
      return true;
    }
    try {
      await cmd.execute(args, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await session.append(
        newMessage({
          role: 'system',
          content: `Command /${name} failed: ${msg}`,
          meta: { source: 'mu-coding', visibility: 'ui', transient: true },
        }),
      );
    }
    return true;
  };

  const submit = async (raw: string): Promise<void> => {
    // If the palette is open with a highlighted item, Enter picks it —
    // overriding whatever partial text the user has typed. This matches
    // the autocomplete UX users expect from slash menus.
    if (showCommandPalette && commandItems.length > 0) {
      const picked = commandItems[paletteCursor] ?? commandItems[0];
      if (picked) {
        setInput('');
        await dispatchCommand(picked.id);
        return;
      }
    }

    const text = raw.trim();
    if (!text || busy) return;
    setInput('');

    if (text.startsWith('/')) {
      const handled = await dispatchCommand(text);
      if (handled) return;
    }

    setBusy(true);
    setHistory((h) => [...h, { id: nextId(), role: 'user', content: text }]);

    const userMsg = newMessage({ role: 'user', content: text });
    let lastStreamLen = 0;
    let lastReasoningLen = 0;
    debugLog('tui', 'submit', { textLen: text.length });
    try {
      for await (const ev of session.run({ userMessage: userMsg })) {
        if (ev.type === 'content') {
          lastStreamLen = ev.text.length;
          setStreaming(ev.text);
        } else if (ev.type === 'reasoning') {
          lastReasoningLen = ev.text.length;
          setStreamingReasoning(ev.text);
        } else if (ev.type === 'message' && ev.message.role === 'assistant') {
          debugLog('tui', 'event.message.assistant', {
            id: ev.message.id,
            contentLen: ev.message.content.length,
            reasoningLen: ev.message.reasoning?.length ?? 0,
            lastStreamLen,
            lastReasoningLen,
          });
          if (ev.message.content || ev.message.reasoning) {
            setHistory((h) => [
              ...h,
              {
                id: ev.message.id,
                role: 'assistant',
                content: ev.message.content,
                reasoning: ev.message.reasoning,
              },
            ]);
          }
          setStreaming('');
          setStreamingReasoning('');
        } else if (ev.type === 'turn_end') {
          debugLog('tui', 'event.turn_end', {
            reason: ev.reason,
            errorMessage: ev.error?.message,
            lastStreamLen,
            lastReasoningLen,
          });
          if (ev.error) {
            setHistory((h) => [
              ...h,
              { id: nextId(), role: 'system', content: `error: ${ev.error?.message ?? 'unknown'}` },
            ]);
          }
          setStreaming('');
          setStreamingReasoning('');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const viewportRows: ViewportRow[] = [];
  for (const row of history) {
    if (!(row.content || row.reasoning)) continue;
    const reasoningText = row.reasoning ?? '';
    const contentText = row.content ?? '';
    const text = [reasoningText, contentText].filter(Boolean).join('\n');
    const isUser = row.role === 'user';
    const isSystem = row.role === 'system';
    viewportRows.push({
      id: row.id,
      text,
      node: (
        <Box flexDirection="column" marginBottom={1}>
          {row.reasoning ? (
            <Box flexDirection="column" marginBottom={row.content ? 1 : 0}>
              <Text dimColor={true}>{row.reasoning}</Text>
            </Box>
          ) : null}
          {row.content ? (
            isUser ? (
              <Box flexDirection="column" backgroundColor={USER_BACKGROUND} paddingX={1} paddingY={1}>
                <Text>{row.content}</Text>
              </Box>
            ) : isSystem ? (
              <Box flexDirection="column" marginBottom={1}>
                <Text dimColor={true}>{row.content}</Text>
              </Box>
            ) : (
              <Box flexDirection="column" marginBottom={1}>
                <Text>{row.content}</Text>
              </Box>
            )
          ) : null}
        </Box>
      ),
    });
  }
  if (streamingReasoning || streaming) {
    const reasoningText = streamingReasoning ?? '';
    const text = [reasoningText, streaming].filter(Boolean).join('\n');
    viewportRows.push({
      id: '__streaming__',
      text,
      node: (
        <Box flexDirection="column" marginBottom={1}>
          {streamingReasoning ? (
            <Box flexDirection="column" marginBottom={streaming ? 1 : 0}>
              <Text dimColor={true}>{streamingReasoning}</Text>
            </Box>
          ) : null}
          {streaming ? (
            <Box flexDirection="column" marginBottom={1}>
              <Text>{streaming}</Text>
            </Box>
          ) : null}
        </Box>
      ),
    });
  }

  const paletteReservedRows = showCommandPalette && commandItems.length > 0 ? 5 + Math.min(commandItems.length, 5) : 5;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <MessagesViewport rows={viewportRows} reservedRows={paletteReservedRows} scrollable={!showCommandPalette} />
      {showCommandPalette && commandItems.length > 0 ? (
        <Box flexShrink={0} flexDirection="column">
          <CommandPalette items={commandItems} cursor={paletteCursor} maxVisible={5} />
        </Box>
      ) : null}
      <Box flexShrink={0}>
        <Text dimColor={true}>{model}</Text>
      </Box>
      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={submit}
        placeholder={busy ? '(streaming…)' : ''}
        focus={!busy}
      />
      <StatusBar
        left={
          busy ? (
            <Text dimColor={true}>
              <Spinner /> streaming
            </Text>
          ) : null
        }
        right={busy ? 'esc to abort' : '/quit to exit'}
      />
      <ExitOnSignal onExit={onExit} />
    </Box>
  );
}

/**
 * Tiny helper component: when the channel commands trigger `onExit`, Ink's
 * `useApp().exit()` from the channel scope can't be called (it's a hook). We
 * expose it via this stub component which lives inside the Ink tree.
 */
function ExitOnSignal({ onExit }: { onExit: () => void }): null {
  const { exit } = useApp();
  useEffect(() => {
    // Bridge: when the channel's exit() is called, we call Ink's exit().
    // The channel sets `triggerInkExit` synchronously; we re-bind every render
    // so the latest exit closure is always used.
    EXIT_BRIDGE.fn = exit;
    return () => {
      if (EXIT_BRIDGE.fn === exit) EXIT_BRIDGE.fn = null;
    };
  }, [exit]);
  // Suppress unused warning — onExit is the channel's outward signal, but the
  // unmount path is driven by Ink's exit() above.
  void onExit;
  return null;
}

const EXIT_BRIDGE: { fn: (() => void) | null } = { fn: null };

const USER_BACKGROUND = '#1a3a4a';

interface TuiChannelOptions {
  baseUrl: string;
  model: string;
  /** Called when the channel finishes (user typed /quit, Ink unmounted, etc.). */
  onClosed: () => void;
}

/**
 * Build a `Channel` + companion `Plugin` that:
 *   - registers host-specific commands (/quit, /exit, /clear) via the
 *     standard `api.command(...)` API, so they show up alongside core's
 *     /help and any plugin-contributed commands;
 *   - on `start(ctx)`, mounts the Ink chat UI and hands `ctx` to React so
 *     the palette / dispatcher read commands straight from mu-core's
 *     registry via `ctx.listCommands()` / `ctx.getCommand()`.
 */
function createTuiChannelPlugin(opts: TuiChannelOptions): Plugin {
  let unmountInk: (() => void) | null = null;
  let waitForInkExit: Promise<void> = Promise.resolve();
  let exitRequested = false;
  let notified = false;

  /**
   * Single entry point for shutting the TUI down. Idempotent.
   *
   * Strategy:
   *   1. Ask Ink to exit (via EXIT_BRIDGE → useApp().exit()). Ink runs React
   *      cleanup, restores stdin from raw mode, and resolves waitUntilExit.
   *   2. `waitForInkExit` (wired in `start`) calls `opts.onClosed()` exactly
   *      once when Ink has finished tearing down. We do NOT call onClosed
   *      synchronously — that used to race the unmount and leave stdin in
   *      raw mode, which kept the Node event loop alive after main() returned.
   *   3. As a safety net, if Ink doesn't unmount within 250 ms (e.g. it was
   *      never fully ready, or React threw during cleanup), force-unmount
   *      and notify. Without this the process could hang on a half-mounted
   *      Ink instance.
   */
  const requestClose = (): void => {
    if (exitRequested) return;
    exitRequested = true;

    // Pi-style shutdown hygiene: drain pending stdin bytes and pause stdin
    // BEFORE asking Ink to unmount. This is the only window during which
    // raw mode is still in effect — once Ink restores cooked mode in its
    // cleanup pass, any buffered byte (e.g. a stray Ctrl+D) gets re-
    // interpreted by the parent shell, which can close the user's SSH
    // session. Ordering: drain → pause → inkExit().
    void (async () => {
      try {
        await drainStdin({ maxMs: 200, idleMs: 30 });
      } catch {
        /* drain errors are non-fatal */
      }
      try {
        process.stdin.pause();
      } catch {
        /* pause errors are non-fatal */
      }
      const inkExit = EXIT_BRIDGE.fn;
      if (inkExit) {
        try {
          inkExit();
        } catch {
          /* Ink exit errors are non-fatal — fall through to the safety net */
        }
      }
    })();

    // Safety net: if Ink hasn't torn down in time, force it. Bumped from
    // 250ms to 500ms so the up-to-200ms drain + Ink's own unmount can
    // complete without the safety net firing mid-teardown.
    setTimeout(() => {
      if (notified) return;
      try {
        unmountInk?.();
      } catch {
        /* unmount errors are non-fatal */
      }
      if (!notified) {
        notified = true;
        opts.onClosed();
      }
    }, 500).unref();
  };

  const channel: Channel = {
    id: 'tui',
    async start(ctx: ChannelContext) {
      // Render options:
      //   - `exitOnCtrlC: false` disables Ink's default behavior of calling
      //     useApp().exit() on Ctrl+C. The Chat component owns Ctrl+C
      //     semantics (cancel-in-flight → clear input → quit) via its
      //     `useInput` handler — mirroring opencode's model where the
      //     OS/Node never get to "protect" the process.
      //   - `alternateScreen: true` puts the TUI on the terminal's
      //     alternate-screen buffer (DECSET 1049). The chat takes over
      //     the full terminal while running, and on exit the user's
      //     original scrollback is restored intact — no transcript
      //     residue is left behind.
      const instance = render(
        <Screen>
          <Chat ctx={ctx} model={opts.model} onExit={requestClose} />
        </Screen>,
        { exitOnCtrlC: false, alternateScreen: true },
      );
      unmountInk = instance.unmount;
      waitForInkExit = instance.waitUntilExit().then(
        () => {
          if (!notified) {
            notified = true;
            opts.onClosed();
          }
        },
        () => {
          if (!notified) {
            notified = true;
            opts.onClosed();
          }
        },
      );
    },
    async stop() {
      requestClose();
      await waitForInkExit;
    },
  };

  const plugin: Plugin = {
    name: 'mu-coding-tui',
    register(api) {
      api.channel(channel);

      const quit: Command = {
        name: 'quit',
        description: 'Exit the TUI',
        execute() {
          requestClose();
        },
      };
      api.command(quit);
      api.command({
        name: 'exit',
        description: 'Exit the TUI',
        execute() {
          requestClose();
        },
      });
      api.command({
        name: 'clear',
        description: 'Clear the transcript',
        execute(_args, session) {
          // Session.clear() emits `transcript_cleared`; the Chat component
          // listens for it and drops its local history.
          session.clear();
        },
      });
    },
  };

  return plugin;
}

export interface RunTuiOptions {
  baseUrl: string;
  model?: string;
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  let model = opts.model;
  if (!model) {
    const picked = await pickModelInteractive(opts.baseUrl);
    if (!picked) return; // user aborted before picking
    model = picked;
  }

  await new Promise<void>((resolveClosed) => {
    let muRef: Mu | null = null;
    const tuiPlugin = createTuiChannelPlugin({
      baseUrl: opts.baseUrl,
      model: model as string,
      onClosed: () => {
        void (async () => {
          try {
            await muRef?.shutdown();
          } finally {
            resolveClosed();
          }
        })();
      },
    });

    void Mu.start({
      config: { baseUrl: opts.baseUrl, model },
      plugins: [createOpenAIProviderPlugin(), tuiPlugin],
    }).then((mu) => {
      muRef = mu;
    });
  });
}
