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
  type PluginAPI,
  type Session,
  type SessionEvent,
} from 'mu-core';
import {
  type ApiModel,
  detectServer,
  formatModelId,
  listModels,
  type LocalServerInfo,
  parseModelId,
} from 'mu-local-provider';
import React from 'react';
import { assemblePlugins } from './plugins';
import { loadCodingSystemPrompt } from './systemPrompt';
import { attachAutoPersist } from './sessionStore/attachAutoPersist';
import { readSession, type SessionFileSummary } from './sessionStore/jsonl';
import { sessionFilePath } from './sessionStore/paths';
import { ApprovalModal } from './tui/ApprovalModal';
import { APPROVAL_BRIDGE, type PendingApproval, tuiApprovalChannel } from './tui/approvalBridge';
import {
  type DropdownItem,
  keyMatches,
  MessagesViewport,
  PromptInput,
  Screen,
  Spinner,
  StatusBar,
  TUI_KEYBINDS,
  TUI_SLOTS,
  useSlot,
  type ViewportRow,
} from './tui/primitives';
import { SessionsPicker } from './tui/SessionsPicker';
import { drainStdin } from './tui/stdin-drain';
import { formatToolCallArgs, formatToolResultPreview } from './tui/transcript';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

interface PickerProps {
  baseUrl: string;
  serverInfo: LocalServerInfo;
  /** Called with the fully-qualified `local/<kind>/<id>` triple. */
  onPick: (qualifiedModelId: string) => void;
  onAbort: () => void;
}

/** Soft cap on the model-id segment when rendering picker rows. */
const MODEL_ID_DISPLAY_CAP = 40;

function truncateModelId(id: string): string {
  if (id.length <= MODEL_ID_DISPLAY_CAP) return id;
  // Ellipsis sits inside the segment so the routing prefix is never truncated.
  return `${id.slice(0, MODEL_ID_DISPLAY_CAP - 1)}…`;
}

function ModelPicker({ baseUrl, serverInfo, onPick, onAbort }: PickerProps): React.ReactElement {
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
      if (chosen) onPick(formatModelId({ kind: serverInfo.kind, id: chosen.id }));
    } else if (key.escape || input === 'q') onAbort();
  });

  if (error) return <Text color="red">Failed to list models: {error}</Text>;
  if (!models) return <Text dimColor={true}>Loading models from {baseUrl}…</Text>;
  if (models.length === 0) return <Text color="yellow">No models available at {baseUrl}</Text>;

  return (
    <Box flexDirection="column">
      <Text bold={true}>Select a model (↑/↓, enter):</Text>
      {models.map((m, i) => {
        const qualified = `local/${serverInfo.kind}/${truncateModelId(m.id)}`;
        return (
          <Text key={m.id} color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '› ' : '  '}
            {qualified}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * Run an Ink-based model picker BEFORE Mu.start() so we can hand the chosen
 * model id into the provider config. Resolves with `null` if the user aborts
 * (q / esc) before picking. The picker is fed pre-detected server info so
 * every row can display the canonical `local/<kind>/<id>` triple — no
 * placeholder/replace flicker.
 */
async function pickModelInteractive(
  baseUrl: string,
  serverInfo: LocalServerInfo,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let picked = false;
    const { unmount, waitUntilExit } = render(
      <Screen>
        <ModelPicker
          baseUrl={baseUrl}
          serverInfo={serverInfo}
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
  baseUrl: string;
  serverInfo: LocalServerInfo;
  initialSessionId: string;
  /** Start a new session. Returns the new session's id (caller attaches autopersist). */
  onNewSession: () => Promise<string>;
  /** Resume a saved session. Returns the resumed session's id. */
  onResumeSession: (summary: SessionFileSummary) => Promise<string>;
  onExit: () => void;
}

/**
 * One row in the chat transcript. The transcript is a discriminated union
 * so user / assistant / system text, tool invocations, and tool results
 * can each carry exactly the data the renderer needs without piling
 * optional fields onto a single shape.
 *
 *  - `message`     — user / assistant / system text (+ optional reasoning).
 *  - `tool_call`   — the assistant invoked a tool; shows `name(arg-values)`.
 *  - `tool_result` — execution outcome; first line of `content` (red on error).
 */
type TranscriptRow = MessageRow | ToolCallRow | ToolResultRow;

interface MessageRow {
  kind: 'message';
  id: string;
  role: Message['role'];
  content: string;
  reasoning?: string;
}

interface ToolCallRow {
  kind: 'tool_call';
  id: string;
  name: string;
  /** Pre-formatted preview, e.g. "ls -la" or "/foo, 100". May be empty. */
  argsPreview: string;
}

interface ToolResultRow {
  kind: 'tool_result';
  id: string;
  name: string;
  /** First non-empty line of the result content, truncated to one line. */
  preview: string;
  error: boolean;
}

/**
 * Render a row for a plain text message (user / assistant / system).
 * Returns null when the message has no visible content.
 */
function messageRowFromMessage(message: Message): MessageRow | null {
  if (!(message.content || message.reasoning)) return null;
  return {
    kind: 'message',
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
  };
}

/**
 * Build tool_call rows for every entry in `message.toolCalls`. The assistant
 * message's `id` is suffixed with the call id so each row gets a stable,
 * unique React key across the transcript and the viewport.
 */
function toolCallRowsFromMessage(message: Message): ToolCallRow[] {
  if (!message.toolCalls || message.toolCalls.length === 0) return [];
  const out: ToolCallRow[] = [];
  for (const tc of message.toolCalls) {
    out.push({
      kind: 'tool_call',
      id: `${message.id}::${tc.id}`,
      name: tc.function.name,
      argsPreview: formatToolCallArgs(tc.function.arguments),
    });
  }
  return out;
}

/** Build a tool_result row for a `role: 'tool'` Message, or null when empty. */
function toolResultRowFromMessage(message: Message): ToolResultRow | null {
  const r = message.toolResult;
  if (!r) return null;
  return {
    kind: 'tool_result',
    id: message.id,
    name: r.name,
    preview: formatToolResultPreview(r.content),
    error: r.error === true,
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

function Chat({
  ctx,
  model,
  baseUrl,
  serverInfo,
  initialSessionId,
  onNewSession,
  onResumeSession,
  onExit,
}: ChatProps): React.ReactElement {
  // `currentSessionId` is the source of truth for which session Chat is
  // currently driving. /new and /sessions update it; `session` is derived
  // (Mu's session map de-duplicates by id, see mu.ts:99-103).
  const [currentSessionId, setCurrentSessionId] = useState(initialSessionId);
  const session = useMemo(() => ctx.session(currentSessionId), [ctx, currentSessionId]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [streaming, setStreaming] = useState<string>('');
  const [streamingReasoning, setStreamingReasoning] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [paletteCursor, setPaletteCursor] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [sessionsPickerOpen, setSessionsPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // Locally mirror the active model so the /model command can show
  // the *current* selection in the AssistantLine immediately after a
  // pick, without waiting for the next session.run() turn. The real
  // value of record lives in `ACTIVE_MODEL_BRIDGE.value`; this state
  // is just a render trigger.
  const [activeModel, setActiveModel] = useState<string>(model);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Follow-up messages typed while a turn is in flight. We deliberately
  // store these in a ref + a parallel state array:
  //   - `queueRef` is the authoritative FIFO consumed by the drain
  //     effect; using a ref avoids the stale-closure problem inside
  //     async handlers and keeps the queue stable across renders.
  //   - `queuedView` mirrors the queue for rendering only (so the user
  //     can SEE what they've enqueued). Order matters: keep them in
  //     lockstep.
  // Both are cleared together on abort and when the queue drains.
  const queueRef = useRef<Array<{ id: string; text: string }>>([]);
  const [queuedView, setQueuedView] = useState<Array<{ id: string; text: string }>>([]);
  const idRef = useRef(0);
  const nextId = (): string => `m-${++idRef.current}`;

  // Bridges for slash commands registered outside React.
  const startNewSession = useCallback(async () => {
    if (busy) {
      setStatusMessage('cannot start a new session while a turn is in flight');
      return;
    }
    try {
      const newId = await onNewSession();
      setCurrentSessionId(newId);
      setHistory([]);
      setStreaming('');
      setStreamingReasoning('');
      setInput('');
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(`could not start a new session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [busy, onNewSession]);

  const openSessionsPicker = useCallback(() => {
    if (busy) {
      setStatusMessage('cannot switch sessions while a turn is in flight');
      return;
    }
    setSessionsPickerOpen(true);
  }, [busy]);

  const openModelPicker = useCallback(() => {
    if (busy) {
      setStatusMessage('cannot switch model while a turn is in flight');
      return;
    }
    setModelPickerOpen(true);
  }, [busy]);

  const pickModel = useCallback((qualified: string) => {
    setModelPickerOpen(false);
    ACTIVE_MODEL_BRIDGE.value = qualified;
    setActiveModel(qualified);
    setStatusMessage(`switched to ${qualified}`);
    // Defer the side-effects (context-limit re-discovery, slot notify)
    // to the host so we don't reach into module state from React.
    MODEL_CHANGE_BRIDGE.fn?.(qualified);
  }, []);

  const resumeSession = useCallback(
    async (summary: SessionFileSummary) => {
      setSessionsPickerOpen(false);
      try {
        const resumedId = await onResumeSession(summary);
        setCurrentSessionId(resumedId);
        setStreaming('');
        setStreamingReasoning('');
        setInput('');
        // Rebuild local history from the resumed session's persisted
        // messages. We strip transient / ui-only items the way Chat
        // already filters live. Each persisted message may expand into
        // multiple rows: a message text row PLUS one tool_call row per
        // entry in toolCalls; tool-role messages become tool_result rows.
        const resumed = ctx.session(resumedId);
        const rows: TranscriptRow[] = [];
        for (const m of resumed.messages()) {
          if (m.meta?.transient === true) continue;
          if (m.meta?.visibility === 'ui') continue;
          if (m.role === 'tool') {
            const r = toolResultRowFromMessage(m);
            if (r) rows.push(r);
            continue;
          }
          const messageRow = messageRowFromMessage(m);
          if (messageRow) rows.push(messageRow);
          if (m.role === 'assistant') {
            for (const tc of toolCallRowsFromMessage(m)) rows.push(tc);
          }
        }
        setHistory(rows);
        setStatusMessage(null);
      } catch (err) {
        setStatusMessage(`could not resume session: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [ctx, onResumeSession],
  );

  useEffect(() => {
    NEW_SESSION_BRIDGE.fn = startNewSession;
    return () => {
      if (NEW_SESSION_BRIDGE.fn === startNewSession) NEW_SESSION_BRIDGE.fn = null;
    };
  }, [startNewSession]);

  useEffect(() => {
    SESSIONS_BRIDGE.fn = openSessionsPicker;
    return () => {
      if (SESSIONS_BRIDGE.fn === openSessionsPicker) SESSIONS_BRIDGE.fn = null;
    };
  }, [openSessionsPicker]);

  useEffect(() => {
    MODEL_PICKER_BRIDGE.fn = openModelPicker;
    return () => {
      if (MODEL_PICKER_BRIDGE.fn === openModelPicker) MODEL_PICKER_BRIDGE.fn = null;
    };
  }, [openModelPicker]);

  // Wire the approval bridge. tuiApprovalChannel queues PendingApproval
  // objects; the modal calls `decide` which resolves the channel promise.
  // We rebind on every render so the latest setState closure is used.
  useEffect(() => {
    APPROVAL_BRIDGE.push = (pending) => setPendingApproval(pending);
    return () => {
      if (APPROVAL_BRIDGE.push === setPendingApproval) APPROVAL_BRIDGE.push = null;
    };
  }, []);

  // Subscribe to session events so plugin-appended system messages
  // (e.g. /help) and mu-core's tool-execution messages flow into the
  // transcript through the canonical channel rather than ad-hoc setState
  // calls in the dispatch path.
  useEffect(() => {
    const off = session.on((ev: SessionEvent) => {
      if (ev.type !== 'message_appended') return;
      const m = ev.message;
      // Skip ui-only transient duplicates.
      if (m.meta?.transient === true) return;
      if (m.meta?.visibility === 'ui') return;
      if (m.role === 'system') {
        const row = messageRowFromMessage(m);
        if (row) setHistory((h) => [...h, row]);
        return;
      }
      if (m.role === 'tool') {
        // mu-core appends one role:'tool' message per executed tool call.
        // Render its outcome inline so the user can see what happened.
        const row = toolResultRowFromMessage(m);
        if (row) setHistory((h) => [...h, row]);
        return;
      }
      // user + assistant text messages are committed locally inside
      // submit() for streaming responsiveness; ignore here to avoid dupes.
    });
    return off;
  }, [session]);

  // Compute the palette state up-front so the keyboard handler below can
  // navigate it. We always read straight from mu-core's registry — plugin-
  // contributed commands (e.g. mu-repomap's /repomap) show up automatically.
  // The palette is suppressed while an approval modal is open so its `useInput`
  // handler doesn't fight with the modal's key bindings.
  const showCommandPalette = !(busy || pendingApproval || sessionsPickerOpen || modelPickerOpen) && input.startsWith('/');
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

  // /quit shares most of this logic but skips the clear-input branch
  // — see QUIT_BRIDGE below. A slash command should not silently
  // swallow itself as "I cleared your prompt for you"; if a turn is
  // in flight the first /quit aborts it (same as Ctrl+C), the second
  // exits.
  const handleQuit = useCallback(() => {
    if (busy) {
      session.abort();
      return;
    }
    process.exit(0);
  }, [busy, session]);

  // Publish the latest handler to the bridge so the plugin's /quit
  // command (registered outside React) can invoke the same logic.
  useEffect(() => {
    QUIT_BRIDGE.fn = handleQuit;
    return () => {
      if (QUIT_BRIDGE.fn === handleQuit) QUIT_BRIDGE.fn = null;
    };
  }, [handleQuit]);

  // Publish the currently active session to a module-level bridge so slot
  // contributors registered outside React (e.g. mu-agents '@agent' indicator
  // wired in `runTui`) can resolve "which session are we showing?".
  // Notifies the slot registry on change so subscribed components re-render.
  useEffect(() => {
    const getter = (): Session => session;
    CURRENT_SESSION_BRIDGE.get = getter;
    TUI_SLOTS.notify();
    return () => {
      if (CURRENT_SESSION_BRIDGE.get === getter) CURRENT_SESSION_BRIDGE.get = null;
    };
  }, [session]);

  useInput((inputChar, key) => {
    // While an approval modal or sessions picker is open, let those
    // components own the keyboard — their own `useInput` handles the
    // relevant keys. We deliberately don't try to be clever here (e.g.
    // forwarding Ctrl+C to abort): a half-aborted turn mid-approval leaves
    // the gateway with a dangling promise.
    if (pendingApproval || sessionsPickerOpen || modelPickerOpen) return;
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
    // already pressed it, that's their intent.
    //
    // Note: `render(...)` below passes `exitOnCtrlC: false` so Ink's
    // built-in handler does not preempt this branch.
    if (key.ctrl && inputChar === 'c') {
      if (busy) {
        // Abort drops queued follow-ups too — if the user is cancelling
        // the in-flight turn, the messages they queued behind it almost
        // certainly belong to that aborted context.
        queueRef.current.length = 0;
        setQueuedView([]);
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
      queueRef.current.length = 0;
      setQueuedView([]);
      session.abort();
      return;
    }
    // Palette navigation — only when the palette is visible and has items.
    // The PromptInput stays focused throughout so the user can keep typing
    // to narrow the query; we only intercept the dedicated nav keys here.
    if (showCommandPalette && commandItems.length > 0) {
      if (key.upArrow) {
        setPaletteCursor((c) => (c - 1 + commandItems.length) % commandItems.length);
        return;
      }
      if (key.downArrow || key.tab) {
        setPaletteCursor((c) => (c + 1) % commandItems.length);
        return;
      }
      if (key.escape) {
        // Clear the slash so the palette closes without submitting.
        setInput('');
        return;
      }
    }

    // Plugin-contributed keybinds. Reserved branches above always win; we
    // only reach this point when no built-in branch consumed the event.
    // Registry is read fresh per event — no useEffect/subscription needed
    // because the dispatcher reads it at event time, not at render time.
    for (const kb of TUI_KEYBINDS.list()) {
      if (kb.when && !kb.when()) continue;
      if (!keyMatches(kb.chord, inputChar, key)) continue;
      if (kb.run() !== false) return;
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

  // Held in a ref so the queue-drain effect below can call into the
  // latest submit closure without listing it as a dep (which would
  // re-fire the effect on every render). The ref is reassigned to
  // every render's closure.
  const submitRef = useRef<((raw: string) => Promise<void>) | null>(null);

  // Drain the follow-up queue when a turn ends. We re-enter `submit`
  // (via `submitRef`) rather than duplicating the run logic, so all
  // the slash-command / palette / model-override branches behave
  // identically for queued messages. One drain per `busy` flip; the
  // recursive submit will set `busy` true again until the queued turn
  // finishes, at which point this effect re-fires on the next flip.
  useEffect(() => {
    if (busy) return;
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift();
    if (!next) return;
    setQueuedView((q) => q.slice(1));
    // Defer to a microtask so React commits the state update from the
    // previous turn (history append, busy=false) before we kick the
    // next one. Without this the effect re-runs in the same cycle
    // and can step on its own state.
    queueMicrotask(() => {
      void submitRef.current?.(next.text);
    });
  }, [busy]);

  const submit = async (raw: string): Promise<void> => {
    // Submissions are inert while the approval modal or sessions picker
    // owns the keyboard.
    if (pendingApproval || sessionsPickerOpen || modelPickerOpen) return;
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
    if (!text) return;
    setInput('');

    if (text.startsWith('/')) {
      // Slash commands dispatch IMMEDIATELY even while a turn is in
      // flight. /quit must be able to abort; /new and /sessions already
      // self-guard with a "cannot ... while a turn is in flight" status
      // message. Queueing them would be surprising and would also
      // prevent the user from interrupting their own session.
      const handled = await dispatchCommand(text);
      if (handled) return;
    }

    // Queue plain-text follow-ups when a turn is in flight. The drain
    // effect below (keyed on `busy` flipping false) will resubmit each
    // queued message in FIFO order. We mirror the queue into
    // `queuedView` so the transcript shows pending messages — without
    // this the user has no feedback that their enter-press was
    // received.
    if (busy) {
      const queuedId = nextId();
      queueRef.current.push({ id: queuedId, text });
      setQueuedView((q) => [...q, { id: queuedId, text }]);
      return;
    }

    setBusy(true);
    setHistory((h) => [...h, { kind: 'message', id: nextId(), role: 'user', content: text }]);

    const userMsg = newMessage({ role: 'user', content: text });
    // Per-call config override: read the latest model from
    // ACTIVE_MODEL_BRIDGE so a mid-conversation /model switch takes
    // effect on the very next turn without restarting Mu. The bridge
    // value is the canonical `local/<kind>/<id>` triple; mu-local-
    // provider strips the routing prefix on the wire.
    const turnModel = ACTIVE_MODEL_BRIDGE.value || undefined;
    let lastStreamLen = 0;
    let lastReasoningLen = 0;
    debugLog('tui', 'submit', { textLen: text.length, model: turnModel });
    try {
      for await (const ev of session.run({
        userMessage: userMsg,
        config: turnModel ? { model: turnModel } : undefined,
      })) {
        if (ev.type === 'content') {
          lastStreamLen = ev.text.length;
          setStreaming(ev.text);
        } else if (ev.type === 'reasoning') {
          lastReasoningLen = ev.text.length;
          setStreamingReasoning(ev.text);
        } else if (ev.type === 'usage') {
          // Surface the just-consumed context size to the AssistantLine
          // slot. `promptTokens` is the authoritative "used" count for
          // this turn — it is everything the server saw including the
          // tools JSON-Schema overhead, so we don't need to estimate.
          // Trigger a slot re-render so the displayed `ctx X / Y`
          // updates without waiting for the next message commit.
          const prev = CTX_BRIDGE.bySession.get(currentSessionId) ?? {};
          CTX_BRIDGE.bySession.set(currentSessionId, {
            ...prev,
            used: ev.usage.promptTokens,
            cached: ev.usage.cachedPromptTokens,
            total: CTX_BRIDGE.totalForModel ?? prev.total,
          });
          TUI_SLOTS.notify();
          // Late-bind the per-model context limit when it wasn't
          // discoverable up front. llama-swap auto-unloads idle models,
          // so a /model switch followed by an immediate discovery probe
          // can hit an empty `/upstream/<id>/slots` (model not yet
          // loaded). After a real turn the model is guaranteed loaded
          // — that's the right moment to retry. The bridge is wired in
          // runTui; we just trigger it here.
          if (!CTX_BRIDGE.totalForModel) {
            MODEL_CHANGE_BRIDGE.fn?.(ACTIVE_MODEL_BRIDGE.value);
          }
        } else if (ev.type === 'message' && ev.message.role === 'assistant') {
          debugLog('tui', 'event.message.assistant', {
            id: ev.message.id,
            contentLen: ev.message.content.length,
            reasoningLen: ev.message.reasoning?.length ?? 0,
            toolCalls: ev.message.toolCalls?.length ?? 0,
            lastStreamLen,
            lastReasoningLen,
          });
          // Commit the assistant turn locally so the streaming preview
          // can be cleared. Order matters: text row first (so the user
          // sees the rationale), then one tool_call row per invocation.
          // Tool_result rows arrive via the session listener as mu-core
          // executes each call.
          const additions: TranscriptRow[] = [];
          if (ev.message.content || ev.message.reasoning) {
            additions.push({
              kind: 'message',
              id: ev.message.id,
              role: 'assistant',
              content: ev.message.content,
              reasoning: ev.message.reasoning,
            });
          }
          for (const row of toolCallRowsFromMessage(ev.message)) {
            additions.push(row);
          }
          if (additions.length > 0) {
            setHistory((h) => [...h, ...additions]);
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
              {
                kind: 'message',
                id: nextId(),
                role: 'system',
                content: `error: ${ev.error?.message ?? 'unknown'}`,
              },
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
  // Publish the latest `submit` closure for the queue-drain effect.
  // Done on every render so closure-captured state (busy, history,
  // pendingApproval, …) is always current when the drain fires.
  submitRef.current = submit;

  const viewportRows: ViewportRow[] = [];
  for (const row of history) {
    if (row.kind === 'tool_call') {
      const label = row.argsPreview ? `▸ ${row.name}(${row.argsPreview})` : `▸ ${row.name}()`;
      viewportRows.push({
        id: row.id,
        text: label,
        marginBottom: 0,
        style: { color: 'cyan', dimColor: true },
        node: (
          <Box flexDirection="column">
            <Text color="cyan" dimColor={true}>
              {label}
            </Text>
          </Box>
        ),
      });
      continue;
    }
    if (row.kind === 'tool_result') {
      // Indented under the call. Errors are red-highlighted so a failing
      // tool stands out at a glance.
      const prefix = row.error ? '  ↳ error: ' : '  ↳ ';
      const label = `${prefix}${row.preview || '(no output)'}`;
      const color = row.error ? 'red' : undefined;
      viewportRows.push({
        id: row.id,
        text: label,
        marginBottom: 1,
        style: { color, dimColor: !row.error },
        node: (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={color} dimColor={!row.error}>
              {label}
            </Text>
          </Box>
        ),
      });
      continue;
    }
    // kind === 'message'
    if (!(row.content || row.reasoning)) continue;
    const isUser = row.role === 'user';
    const isSystem = row.role === 'system';
    // Reasoning and content become separate viewport rows. This lets the
    // viewport account for each block's actual rendered height (including
    // the colored-background padding on a user message) and scroll into
    // long blocks line by line.
    if (row.reasoning) {
      const mb = row.content ? 1 : 0;
      viewportRows.push({
        id: `${row.id}#r`,
        text: row.reasoning,
        marginBottom: mb,
        style: { dimColor: true },
        node: (
          <Box flexDirection="column" marginBottom={mb}>
            <Text dimColor={true}>{row.reasoning}</Text>
          </Box>
        ),
      });
    }
    if (row.content) {
      if (isUser) {
        viewportRows.push({
          id: row.id,
          text: row.content,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: USER_BACKGROUND,
          marginBottom: 1,
          node: (
            <Box flexDirection="column" marginBottom={1}>
              <Box flexDirection="column" backgroundColor={USER_BACKGROUND} paddingX={1} paddingY={1}>
                <Text>{row.content}</Text>
              </Box>
            </Box>
          ),
        });
      } else if (isSystem) {
        viewportRows.push({
          id: row.id,
          text: row.content,
          marginBottom: 1,
          style: { dimColor: true },
          node: (
            <Box flexDirection="column" marginBottom={1}>
              <Text dimColor={true}>{row.content}</Text>
            </Box>
          ),
        });
      } else {
        viewportRows.push({
          id: row.id,
          text: row.content,
          marginBottom: 1,
          node: (
            <Box flexDirection="column" marginBottom={1}>
              <Text>{row.content}</Text>
            </Box>
          ),
        });
      }
    }
  }
  if (streamingReasoning || streaming) {
    if (streamingReasoning) {
      const mb = streaming ? 1 : 0;
      viewportRows.push({
        id: '__streaming__#r',
        text: streamingReasoning,
        marginBottom: mb,
        style: { dimColor: true },
        node: (
          <Box flexDirection="column" marginBottom={mb}>
            <Text dimColor={true}>{streamingReasoning}</Text>
          </Box>
        ),
      });
    }
    if (streaming) {
      viewportRows.push({
        id: '__streaming__',
        text: streaming,
        marginBottom: 1,
        node: (
          <Box flexDirection="column" marginBottom={1}>
            <Text>{streaming}</Text>
          </Box>
        ),
      });
    }
  }
  // Queued follow-ups: render below the live stream as dim rows with a
  // small "queued" tag so the user has explicit feedback that their
  // Enter-press was received and the message will fire after the
  // current turn completes. The viewport is append-only so each queued
  // message gets a stable id from the same nextId() pool as committed
  // messages.
  for (const q of queuedView) {
    viewportRows.push({
      id: `queued-${q.id}`,
      text: q.text,
      marginBottom: 1,
      style: { dimColor: true },
      node: (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor={true}>
            <Text color="yellow">[queued] </Text>
            {q.text}
          </Text>
        </Box>
      ),
    });
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <MessagesViewport rows={viewportRows} scrollable={!showCommandPalette} />
      {pendingApproval ? (
        <Box flexShrink={0} flexDirection="column">
          <ApprovalModal
            request={pendingApproval.request}
            onDecide={(decision) => {
              pendingApproval.decide(decision);
              setPendingApproval(null);
            }}
          />
        </Box>
      ) : null}
      {sessionsPickerOpen ? (
        <Box flexShrink={0} flexDirection="column">
          <SessionsPicker onSelect={resumeSession} onCancel={() => setSessionsPickerOpen(false)} />
        </Box>
      ) : null}
      {modelPickerOpen ? (
        <Box flexShrink={0} flexDirection="column">
          <ModelPicker
            baseUrl={baseUrl}
            serverInfo={serverInfo}
            onPick={pickModel}
            onAbort={() => setModelPickerOpen(false)}
          />
        </Box>
      ) : null}
      {statusMessage ? (
        <Box flexShrink={0}>
          <Text color="yellow">{statusMessage}</Text>
        </Box>
      ) : null}
      {showCommandPalette && commandItems.length > 0 ? (
        <Box flexShrink={0} flexDirection="column">
          <CommandPalette items={commandItems} cursor={paletteCursor} maxVisible={5} />
        </Box>
      ) : null}
      <AssistantLine />
      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={submit}
        placeholder={
          pendingApproval
            ? '(awaiting approval…)'
            : sessionsPickerOpen
              ? '(picking session…)'
              : modelPickerOpen
                ? '(picking model…)'
                : busy
                  ? '(streaming — type to queue a follow-up)'
                  : ''
        }
        focus={!(pendingApproval || sessionsPickerOpen || modelPickerOpen)}
      />
      <StatusBar
        left={
          busy ? (
            <Text dimColor={true}>
              <Spinner /> streaming
              {queuedView.length > 0 ? ` · ${queuedView.length} queued` : ''}
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
 * Render the `assistantLine` slot on a single dim row above the prompt.
 * Contributors are space-separated (two spaces) and rendered in registration
 * order. When no contributor returns content, the row is suppressed entirely
 * so the prompt sits flush with whatever's above.
 *
 * Contributors may return either a plain string (inherits the host's outer
 * dimColor) or a fully-styled `<Text>` element when they want their own
 * color/weight (e.g. the agents contributor uses `agent.color` from the
 * agent's markdown frontmatter to colorize `@agentName`). Ink resolves
 * styling depth-first, so a child `<Text color="...">` overrides the
 * outer dimColor wrapper without affecting siblings.
 *
 * This slot is wired by `runTui` (host) at process start:
 *   - A default contributor shows the model id.
 *   - When mu-agents is loaded, a second contributor shows '@agentName' for
 *     the active session, colored per the agent's frontmatter.
 */
function AssistantLine(): React.ReactElement | null {
  const nodes = useSlot('assistantLine');
  if (nodes.length === 0) return null;
  return (
    <Box flexShrink={0}>
      <Text dimColor={true}>
        {nodes.map((n, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: slot order is stable for the lifetime of a render
          <React.Fragment key={`slot-${i}`}>
            {i > 0 ? '  ' : ''}
            {n}
          </React.Fragment>
        ))}
      </Text>
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

/**
 * Bridge for the Chat component's quit handler. /quit is registered
 * inside `createTuiChannelPlugin` (outside React) so it can't reach
 * Chat's `useInput` closure directly. Chat publishes a `handleQuit`
 * callback here on every render; the command invokes it.
 *
 * `handleQuit` mirrors physical Ctrl+C's cancel→kill chain MINUS the
 * "clear input" branch — a slash command should never silently swallow
 * itself as "I cleared your prompt for you". If a turn is in flight the
 * first /quit aborts it (same as Ctrl+C); the user then issues /quit
 * again to actually exit.
 */
const QUIT_BRIDGE: { fn: (() => void) | null } = { fn: null };

/**
 * Bridge for the /new command — registered outside React, invoked by Chat
 * via useEffect-bound callback. Mirrors EXIT_BRIDGE / QUIT_BRIDGE.
 */
const NEW_SESSION_BRIDGE: { fn: (() => void | Promise<void>) | null } = { fn: null };

/**
 * Bridge for the /sessions command — opens the picker rendered inside Chat.
 */
const SESSIONS_BRIDGE: { fn: (() => void) | null } = { fn: null };

/**
 * Bridge exposing Chat's currently-active Session to non-React code (e.g.
 * slot contributors registered in `runTui`). Chat rebinds the getter on
 * every render so the latest session id is always reachable; returns null
 * when no Chat is mounted (process startup / shutdown).
 */
const CURRENT_SESSION_BRIDGE: { get: (() => Session) | null } = { get: null };

/**
 * Active model id (canonical `local/<kind>/<id>` triple). Initialised in
 * `runTui` after detection + initial pick, mutated by the `/model` flow.
 *
 * Why a mutable singleton instead of `Mu.start({ config.model })`:
 * mu-core's `_config` is frozen-by-convention (the field is `@internal`).
 * `session.run({ config })` already accepts a per-call override that
 * shallow-merges over `mu._config`, so Chat reads this bridge in
 * `submit()` and passes the current model into each turn. That makes
 * mid-session switching atomic: in-flight turns finish on the previous
 * model; the next turn starts on the new one.
 *
 * One model per process. mu-coding does not yet support a per-session
 * model selection.
 */
const ACTIVE_MODEL_BRIDGE: { value: string } = { value: '' };

/**
 * Open the in-Chat model picker overlay. Set by `Chat` on mount,
 * invoked by the `/model` slash command via the standard bridge
 * pattern.
 */
const MODEL_PICKER_BRIDGE: { fn: (() => void) | null } = { fn: null };

/**
 * Called by Chat after the user picks a new model. Wired in `runTui`
 * so we can side-effect outside React: re-discover context limit, reset
 * the per-model total in `CTX_BRIDGE`, and notify slots.
 */
const MODEL_CHANGE_BRIDGE: { fn: ((newModel: string) => void) | null } = { fn: null };

/**
 * Format a token count compactly. Big context windows (e.g. 200_000) are
 * easier to read as `200k` than `200000` on the AssistantLine, and tiny
 * counts stay as raw integers so the user can still see precision when
 * it matters. One decimal place is kept for counts ≥ 10k to avoid the
 * jump from "9k" to "200k" hiding mid-range values.
 */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Per-session context-window state. Updated by:
 *   - `Chat.submit()` on every `usage` event yielded by `session.run()`,
 *     which surfaces `promptTokens` (the total context size the server
 *     just consumed = system prompt + tools schema + transcript + new
 *     user turn).
 *   - `runTui` once `localProviderHandle.getModelInfo(baseUrl, modelId)`
 *     resolves, populating `total` for sessions whose model maps to a
 *     server kind that supports discovery (today: llama-swap, llama-cpp).
 *
 * Keyed by sessionId because each Chat may swap sessions (/new, resume).
 * Values are short-lived; the AssistantLine slot is the only reader.
 */
interface CtxSnapshot {
  used?: number;
  total?: number;
  cached?: number;
}
const CTX_BRIDGE: {
  bySession: Map<string, CtxSnapshot>;
  /**
   * Discovered context limit for the active model. Single-valued because
   * mu-coding holds one model per process. Sessions all share it.
   */
  totalForModel?: number;
} = { bySession: new Map() };

const USER_BACKGROUND = '#1a3a4a';

interface TuiChannelOptions {
  baseUrl: string;
  model: string;
  serverInfo: LocalServerInfo;
  /** Called when the channel finishes (user typed /quit, Ink unmounted, etc.). */
  onClosed: () => void;
}

/**
 * Build a `Channel` + companion `Plugin` that:
 *   - registers host-specific commands (/quit, /new, /sessions) via the
 *     standard `api.command(...)` API, so they show up alongside core's
 *     /help and any plugin-contributed commands;
 *   - on `start(ctx)`, creates the initial Session, attaches the JSONL
 *     auto-persist subscriber, then mounts the Ink chat UI;
 *   - hands `onNewSession` / `onResumeSession` callbacks to Chat so the
 *     React tree never touches disk directly — all I/O is owned here.
 */
function createTuiChannelPlugin(opts: TuiChannelOptions): Plugin {
  let unmountInk: (() => void) | null = null;
  let waitForInkExit: Promise<void> = Promise.resolve();
  let exitRequested = false;
  let notified = false;
  /**
   * Active autopersist unsubscriber. Replaced on every /new and resume.
   * Detached on shutdown.
   */
  let detachPersist: (() => void) | null = null;
  /**
   * Captured from `register()` so `channel.start` can call api.createSession
   * with `initialMessages` (ChannelContext.session only takes an id).
   */
  let pluginApi: PluginAPI | null = null;

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

  /**
   * Wire autopersist for `session`. Detaches any previous attach. Failures
   * are logged via the bridge-bound status message; we never throw, since
   * disk hiccups should not crash the TUI.
   */
  const persistSession = async (
    session: ReturnType<ChannelContext['session']>,
    options: { resumeExisting: boolean },
  ): Promise<void> => {
    detachPersist?.();
    detachPersist = null;
    try {
      const off = await attachAutoPersist(session, {
        header: {
          id: session.id,
          createdAt: session.createdAt,
          cwd: process.cwd(),
          model: opts.model,
          baseUrl: opts.baseUrl,
          source: 'mu-coding',
        },
        filePath: sessionFilePath(session.id),
        resumeExisting: options.resumeExisting,
      });
      detachPersist = off;
    } catch (err) {
      process.stderr.write(
        `[mu] persistence disabled for session ${session.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };

  const channel: Channel = {
    id: 'tui',
    async start(ctx: ChannelContext) {
      // Create the initial session up-front so we can attach autopersist
      // BEFORE the first message is appended. Chat will look it up by id
      // via ctx.session(initialSessionId), which Mu de-dupes by id.
      const initialSession = ctx.session();
      await persistSession(initialSession, { resumeExisting: false });

      const onNewSession = async (): Promise<string> => {
        const fresh = ctx.session();
        await persistSession(fresh, { resumeExisting: false });
        return fresh.id;
      };

      const onResumeSession = async (summary: SessionFileSummary): Promise<string> => {
        // Resume policy: load the prior conversation into a fresh in-memory
        // session (new id) and persist it to a new file. The previous file
        // stays untouched and continues to appear in /sessions. This makes
        // "resume" effectively "fork from"; it side-steps two thorny issues
        // — appending to an existing file with a mismatched in-memory id,
        // and mutating a JSONL the user might be reading externally.
        if (!pluginApi) throw new Error('plugin api not yet captured');
        const loaded = await readSession(summary.path);
        const session = pluginApi.createSession({ initialMessages: loaded.messages });
        await persistSession(session, { resumeExisting: false });
        return session.id;
      };

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
          <Chat
            ctx={ctx}
            model={opts.model}
            baseUrl={opts.baseUrl}
            serverInfo={opts.serverInfo}
            initialSessionId={initialSession.id}
            onNewSession={onNewSession}
            onResumeSession={onResumeSession}
            onExit={requestClose}
          />
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
      detachPersist?.();
      detachPersist = null;
      requestClose();
      await waitForInkExit;
    },
  };

  const plugin: Plugin = {
    name: 'mu-coding-tui',
    register(api) {
      pluginApi = api;
      api.channel(channel);

      // /quit shares Ctrl+C's cancel→kill chain EXCEPT for the
      // clear-input step — see QUIT_BRIDGE / handleQuit. The graceful
      // `requestClose()` path is no longer used for user-driven exit;
      // it remains wired up for channel.stop() and Ink's own unmount
      // lifecycle.
      const quitNow = (): void => {
        const fn = QUIT_BRIDGE.fn;
        if (fn) {
          fn();
          return;
        }
        // Fallback if Chat hasn't mounted yet — should be unreachable
        // in practice since commands can only be dispatched from the
        // mounted Chat UI.
        process.exit(0);
      };
      const quit: Command = {
        name: 'quit',
        description: 'Exit the TUI',
        execute() {
          quitNow();
        },
      };
      api.command(quit);
      api.command({
        name: 'new',
        description: 'Start a new conversation (the previous one is saved)',
        execute() {
          // Chat owns the swap so React state stays consistent. The bridge
          // is rebound on every render so we always call the latest closure.
          const fn = NEW_SESSION_BRIDGE.fn;
          if (fn) void fn();
        },
      });
      api.command({
        name: 'sessions',
        description: 'List and resume saved sessions',
        execute() {
          SESSIONS_BRIDGE.fn?.();
        },
      });
      api.command({
        name: 'model',
        description: 'Switch the active model (opens picker)',
        execute() {
          MODEL_PICKER_BRIDGE.fn?.();
        },
      });
    },
  };

  return plugin;
}

export interface RunTuiOptions {
  baseUrl: string;
  model?: string;
  /**
   * Plugin names from `config.plugins`. Passed through to `assemblePlugins`,
   * which validates them and decides which optional plugins to wire.
   */
  plugins?: readonly string[];
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  // Detect the local server kind up-front (≤1.5s probe). Doing this BEFORE
  // the model picker means every row can render the fully-qualified
  // `local/<kind>/<id>` triple from the first paint. Detection is cached
  // per-baseUrl so the second call inside the plugin is free. When neither
  // llama-swap nor llama-cpp respond, kind falls through to 'unknown' and
  // we proceed permissively — streaming still works on any OpenAI-
  // compatible server, only context-window discovery is unavailable.
  const serverInfo = await detectServer(opts.baseUrl);
  if (serverInfo.kind === 'unknown') {
    process.stderr.write(
      `[mu] could not detect a supported local server at ${opts.baseUrl} (probed /running, /props); context-usage display will be limited.\n`,
    );
  }

  // Resolve the active model. Accept three shapes (bare, kind-qualified,
  // fully-qualified) from CLI/env/config; canonicalise against detection.
  // If the user-supplied `kind` segment disagrees with detection we trust
  // detection (it's measured, the config is a stale hint) and warn.
  let qualifiedModel: string | undefined;
  if (opts.model) {
    const parsed = parseModelId(opts.model);
    if (parsed.kind && parsed.kind !== serverInfo.kind) {
      process.stderr.write(
        `[mu] model "${opts.model}" claims kind "${parsed.kind}" but server is "${serverInfo.kind}"; using detection.\n`,
      );
    }
    qualifiedModel = formatModelId({ kind: serverInfo.kind, id: parsed.id });
  } else {
    const picked = await pickModelInteractive(opts.baseUrl, serverInfo);
    if (!picked) return; // user aborted before picking
    qualifiedModel = picked;
  }
  const model = qualifiedModel;
  // Initialise the active-model bridge. Chat reads this on every submit()
  // and the `/model` command rewrites it on user pick.
  ACTIVE_MODEL_BRIDGE.value = model;

  await new Promise<void>((resolveClosed) => {
    let muRef: Mu | null = null;
    // Slot detachers — populated below once we know whether mu-agents is on.
    // Invoked from `onClosed` so the registry stays clean across runs (e.g.
    // when this function is called multiple times in a test).
    const slotDetachers: Array<() => void> = [];
    const tuiPlugin = createTuiChannelPlugin({
      baseUrl: opts.baseUrl,
      model,
      serverInfo,
      onClosed: () => {
        void (async () => {
          try {
            for (const d of slotDetachers) {
              try {
                d();
              } catch {
                /* best-effort */
              }
            }
            slotDetachers.length = 0;
            await muRef?.shutdown();
          } finally {
            resolveClosed();
          }
        })();
      },
    });

    // Host-implemented KeybindChannel: hands mu-agents (or any other
    // plugin that learns the interface later) a way to contribute key
    // bindings without taking a dependency on mu-coding. The channel
    // adapts:
    //   - `TUI_KEYBINDS` (the in-process registry the Chat dispatcher
    //     consults on every keystroke), and
    //   - `CURRENT_SESSION_BRIDGE` (Chat publishes the focused Session
    //     on every render).
    // Plugin-side keybinds get torn down via the standard plugin
    // deactivate() hook; nothing extra to wire here.
    const keybindChannel = {
      registry: TUI_KEYBINDS,
      currentSession: (): Session | null => CURRENT_SESSION_BRIDGE.get?.() ?? null,
    };

    const { plugins, agentsHandle, localProviderHandle } = assemblePlugins({
      configPlugins: opts.plugins ?? [],
      approval: tuiApprovalChannel,
      keybinds: keybindChannel,
    });

    // Discover the runtime context window for the active model. The
    // model field is the fully-qualified triple `local/<kind>/<id>`;
    // mu-local-provider's `getModelInfo` accepts a bare id, so we strip
    // the routing prefix first. Detection is cached per-baseUrl inside
    // the provider, so this resolves quickly even if it races with
    // streaming. Fire-and-forget: when the limit lands, stash it and
    // notify the slot registry so the AssistantLine repaints.
    //
    // We re-run this whenever the user switches model via /model — the
    // new model may have a different `--ctx-size`.
    const discoverContextLimit = (qualifiedModelId: string): void => {
      const bare = parseModelId(qualifiedModelId).id;
      void localProviderHandle.getModelInfo(opts.baseUrl, bare).then((info) => {
        CTX_BRIDGE.totalForModel = info.runtimeContextLimit;
        // Update every cached snapshot to point at the new total
        // (or clear it when discovery yielded nothing for this model).
        for (const [sid, snap] of CTX_BRIDGE.bySession) {
          CTX_BRIDGE.bySession.set(sid, { ...snap, total: info.runtimeContextLimit });
        }
        TUI_SLOTS.notify();
      });
    };
    discoverContextLimit(model);

    // Wire the /model change-handler. Chat owns the picker UI and
    // ACTIVE_MODEL_BRIDGE update; this side-effect path lives here
    // because it touches non-React module state (CTX_BRIDGE) and
    // network discovery.
    MODEL_CHANGE_BRIDGE.fn = (newModel) => {
      discoverContextLimit(newModel);
      TUI_SLOTS.notify();
    };
    slotDetachers.push(() => {
      if (MODEL_CHANGE_BRIDGE.fn) MODEL_CHANGE_BRIDGE.fn = null;
    });

    // Default `assistantLine` contributor: fully-qualified model triple
    // (`local/<kind>/<id>`). Reads from ACTIVE_MODEL_BRIDGE so the
    // displayed model updates the moment the user picks a new one via
    // /model. Falls back to the boot-time model when the bridge is
    // empty (shouldn't happen — initialised at runTui start). When
    // detection lands on `unknown` the segment still appears literally
    // as `local/unknown/<id>` — silence would hide failed detection.
    slotDetachers.push(TUI_SLOTS.register('assistantLine', () => ACTIVE_MODEL_BRIDGE.value || model));

    // Context-usage contributor: `ctx <used>/<total> (<pct>%)`. Reads
    // from CTX_BRIDGE which Chat.submit() populates on every usage
    // event. Hidden until at least one turn has produced a usage
    // event for the current session — there's nothing to display
    // before the first server roundtrip.
    slotDetachers.push(
      TUI_SLOTS.register('assistantLine', () => {
        const session = CURRENT_SESSION_BRIDGE.get?.();
        if (!session) return null;
        const snap = CTX_BRIDGE.bySession.get(session.id);
        if (!snap || snap.used === undefined) return null;
        const used = snap.used;
        const total = snap.total ?? CTX_BRIDGE.totalForModel;
        const usedStr = formatCount(used);
        if (!total) {
          // No discovered limit (unknown server kind or probe failed).
          // Show just the used count — invent nothing.
          return (
            <Text color="cyan" dimColor={true}>
              ctx {usedStr}
            </Text>
          );
        }
        const pct = Math.min(100, Math.round((used / total) * 100));
        // Threshold colors: green <75%, yellow 75-90%, red >90%. The
        // outer AssistantLine wrapper applies dimColor; nested <Text>
        // with an explicit color overrides it so the user notices.
        const color = pct > 90 ? 'red' : pct > 75 ? 'yellow' : 'cyan';
        return (
          <Text color={color} dimColor={pct <= 75}>
            ctx {usedStr}/{formatCount(total)} ({pct}%)
          </Text>
        );
      }),
    );

    // When mu-agents is loaded, layer an '@agentName' indicator alongside.
    // We resolve the active agent through CURRENT_SESSION_BRIDGE, which
    // Chat rebinds on every render. `onSwitch` notifies the slot registry
    // so the line re-renders the instant the user (or a tool) flips
    // agent — including switches driven by mu-agents' own Shift+Tab
    // keybind registration, which lives inside that plugin now.
    if (agentsHandle) {
      slotDetachers.push(
        TUI_SLOTS.register('assistantLine', () => {
          const session = CURRENT_SESSION_BRIDGE.get?.();
          if (!session) return null;
          const agent = agentsHandle.getActive(session);
          if (!agent) return null;
          const label = `@${agent.name}`;
          // Agents may declare a `color` (hex string or any Ink-recognised
          // color name) in their markdown frontmatter. We honour it here
          // so the user sees at a glance which agent is active. Nested
          // <Text> overrides the host's outer dimColor wrapper, so the
          // agent renders at full intensity while the model id alongside
          // stays dim.
          if (agent.color) {
            return (
              <Text color={agent.color} bold={true}>
                {label}
              </Text>
            );
          }
          return label;
        }),
      );
      slotDetachers.push(agentsHandle.onSwitch(() => TUI_SLOTS.notify()));
    }

    // Identity prompt. Sits at the *start* of the composed system message
    // (see resolveSystemPrompt in mu-core/src/mu.ts) so plugin contributions
    // — mu-tools' tool-usage hint, mu-repomap, etc. — append after the
    // "who am I" statement. `loadCodingSystemPrompt()` resolves to the
    // user's `~/.config/mu/SYSTEM.md` override when present, otherwise
    // falls back to the bundled `packages/mu-coding/SYSTEM.md`.
    const systemPrompt = loadCodingSystemPrompt();
    // `providerId: 'local'` is required — mu-core has no default provider.
    // The model field carries the fully-qualified `local/<kind>/<id>`
    // triple; mu-local-provider strips the routing prefix internally
    // before issuing the OpenAI call (see plugin.ts adaptStreamChat).
    void Mu.start({
      config: {
        baseUrl: opts.baseUrl,
        model,
        providerId: 'local',
        systemPrompt: systemPrompt || undefined,
      },
      plugins: [...plugins, tuiPlugin],
    }).then((mu) => {
      muRef = mu;
    });
  });
}
