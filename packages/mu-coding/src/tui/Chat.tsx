import type { Key } from 'ink';
import { Box, Text, useApp, useInput } from 'ink';
import { type AgentsHandle, parseMention, type SubAgentResult } from 'mu-agents';
import { type ChannelContext, newMessage, type Session } from 'mu-core';
import type { LocalServerInfo } from 'mu-local-provider';
import React from 'react';
import { parseInput } from '../logic/commandParser';
import { rowsFromResumedMessages } from '../logic/transcriptBuilder';
import type { SessionFileSummary } from '../sessionStore/jsonl';
import { APPROVAL_BRIDGE, type PendingApproval } from './approvalBridge';
import {
  ACTIVE_MODEL_BRIDGE,
  AGENT_COLOR_BRIDGE,
  BASH_BRIDGE,
  CTX_BRIDGE,
  CURRENT_SESSION_BRIDGE,
  EXIT_BRIDGE,
  MODEL_CHANGE_BRIDGE,
  MODEL_PICKER_BRIDGE,
  NEW_SESSION_BRIDGE,
  QUIT_BRIDGE,
  SESSIONS_BRIDGE,
} from './bridges';
import { ApprovalModal } from './components/ApprovalModal';
import { AssistantLine } from './components/AssistantLine';
import { ModelPicker } from './components/ModelPicker';
import { SessionsPicker } from './components/SessionsPicker';
import { StatusBarContent } from './components/StatusBarContent';
import { SubAgentBanner } from './components/SubAgentBanner';
import { TranscriptView } from './components/TranscriptView';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useMentionPalette } from './hooks/useMentionPalette';
import { useMessageStream } from './hooks/useMessageStream';
import { type SubAgentFeed, useSubAgentFeeds } from './hooks/useSubAgentFeeds';
import { AutocompleteDropdown, keyMatches, PromptInput, TUI_KEYBINDS, TUI_SLOTS } from './primitives';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

function useBridgeFn(bridge: { fn: (() => void | Promise<void>) | null }, handler: () => void | Promise<void>) {
  useEffect(() => {
    bridge.fn = handler;
    return () => {
      if (bridge.fn === handler) bridge.fn = null;
    };
  }, [handler]);
}

interface ChatProps {
  ctx: ChannelContext;
  baseUrl: string;
  serverInfo: LocalServerInfo;
  initialSessionId: string;
  agentsHandle?: AgentsHandle | undefined;
  onNewSession: () => Promise<string>;
  onResumeSession: (summary: SessionFileSummary) => Promise<string>;
  onExit: () => void;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: full TUI composition
export function Chat({
  ctx,
  baseUrl,
  serverInfo,
  initialSessionId,
  agentsHandle,
  onNewSession,
  onResumeSession,
  onExit,
}: ChatProps): React.ReactElement {
  const [currentSessionId, setCurrentSessionId] = useState(initialSessionId);
  const session = useMemo(() => ctx.session(currentSessionId), [ctx, currentSessionId]);
  const [input, setInput] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [sessionsPickerOpen, setSessionsPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [navPrefix, setNavPrefix] = useState(false);
  const [focusedSubAgentRunId, setFocusedSubAgentRunId] = useState<string | null>(null);
  const queueRef = useRef<Array<{ id: string; text: string }>>([]);
  const [queuedView, setQueuedView] = useState<Array<{ id: string; text: string }>>([]);

  const stream = useMessageStream(session, currentSessionId);
  const {
    busy,
    history,
    streaming,
    streamingReasoning,
    appendRows,
    runTurn,
    runMessageTurn,
    nextId,
    clearStreaming,
    setHistory,
  } = stream;

  const blocked = busy || !!pendingApproval || sessionsPickerOpen || modelPickerOpen;
  const palette = useCommandPalette(input, ctx, blocked);
  const mentionPalette = useMentionPalette(input, agentsHandle, blocked);
  const subAgentFeeds = useSubAgentFeeds(agentsHandle, currentSessionId);
  const focusedSubAgent = focusedSubAgentRunId
    ? subAgentFeeds.find((feed) => feed.runId === focusedSubAgentRunId)
    : undefined;
  const focusedSubAgentIndex = focusedSubAgent
    ? subAgentFeeds.findIndex((feed) => feed.runId === focusedSubAgent.runId)
    : -1;

  useEffect(() => {
    if (!focusedSubAgentRunId) return;
    if (subAgentFeeds.some((feed) => feed.runId === focusedSubAgentRunId)) return;
    setFocusedSubAgentRunId(null);
  }, [focusedSubAgentRunId, subAgentFeeds]);

  useEffect(() => {
    if (!navPrefix) return;
    const timeout = setTimeout(() => setNavPrefix(false), 1500);
    return () => clearTimeout(timeout);
  }, [navPrefix]);

  const focusSubAgentAt = useCallback(
    (index: number): boolean => {
      if (subAgentFeeds.length === 0) {
        setStatusMessage('no subagent runs yet');
        return false;
      }
      const normalized = (index + subAgentFeeds.length) % subAgentFeeds.length;
      const feed = subAgentFeeds[normalized];
      if (!feed) return false;
      setFocusedSubAgentRunId(feed.runId);
      setStatusMessage(null);
      return true;
    },
    [subAgentFeeds],
  );

  const navigateSubAgents = useCallback(
    (key: Key): boolean => {
      if (key.upArrow) {
        setFocusedSubAgentRunId(null);
        setStatusMessage(null);
        return true;
      }
      if (key.downArrow) return focusSubAgentAt(subAgentFeeds.length - 1);
      if (key.leftArrow)
        return focusSubAgentAt(focusedSubAgentIndex >= 0 ? focusedSubAgentIndex - 1 : subAgentFeeds.length - 1);
      if (key.rightArrow) return focusSubAgentAt(focusedSubAgentIndex >= 0 ? focusedSubAgentIndex + 1 : 0);
      return false;
    },
    [focusSubAgentAt, focusedSubAgentIndex, subAgentFeeds.length],
  );

  const handleSubAgentNavKey = useCallback(
    (ch: string, key: Key): boolean => {
      if (key.ctrl && ch === 'x') {
        setNavPrefix(true);
        return true;
      }
      if (!navPrefix) return false;
      setNavPrefix(false);
      if (key.escape) return true;
      if (navigateSubAgents(key)) return true;
      return true;
    },
    [navPrefix, navigateSubAgents],
  );

  useInput(
    (ch, key) => {
      handleSubAgentNavKey(ch, key);
    },
    { isActive: focusedSubAgent !== undefined },
  );

  const startNewSession = useCallback(async () => {
    if (busy) {
      setStatusMessage('cannot start a new session while a turn is in flight');
      return;
    }
    try {
      const newId = await onNewSession();
      setCurrentSessionId(newId);
      setHistory([]);
      clearStreaming();
      setInput('');
      setFocusedSubAgentRunId(null);
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(`could not start a new session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [busy, onNewSession, setHistory, clearStreaming]);

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
    setStatusMessage(`switched to ${qualified}`);
    MODEL_CHANGE_BRIDGE.fn?.(qualified);
  }, []);

  const resumeSession = useCallback(
    async (summary: SessionFileSummary) => {
      setSessionsPickerOpen(false);
      try {
        const resumedId = await onResumeSession(summary);
        setCurrentSessionId(resumedId);
        clearStreaming();
        setInput('');
        setFocusedSubAgentRunId(null);
        const resumed = ctx.session(resumedId);
        setHistory(
          rowsFromResumedMessages(
            resumed.messages().filter((m) => m.meta?.transient !== true && m.meta?.visibility !== 'ui'),
          ),
        );
        setStatusMessage(null);
      } catch (err) {
        setStatusMessage(`could not resume session: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [ctx, onResumeSession, clearStreaming, setHistory],
  );

  useBridgeFn(NEW_SESSION_BRIDGE, startNewSession);
  useBridgeFn(SESSIONS_BRIDGE, openSessionsPicker);
  useBridgeFn(MODEL_PICKER_BRIDGE, openModelPicker);

  useEffect(() => {
    APPROVAL_BRIDGE.push = (pending) => setPendingApproval(pending);
    return () => {
      if (APPROVAL_BRIDGE.push === setPendingApproval) APPROVAL_BRIDGE.push = null;
    };
  }, []);

  useEffect(() => {
    const getter = (): Session => session;
    CURRENT_SESSION_BRIDGE.get = getter;
    TUI_SLOTS.notify();
    return () => {
      if (CURRENT_SESSION_BRIDGE.get === getter) CURRENT_SESSION_BRIDGE.get = null;
    };
  }, [session]);

  const handleQuit = useCallback(() => {
    if (busy) {
      session.abort();
      return;
    }
    process.exit(0);
  }, [busy, session]);

  useBridgeFn(QUIT_BRIDGE, handleQuit);

  const dispatchCommand = useCallback(
    async (name: string, args: string): Promise<boolean> => {
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
    },
    [ctx, session],
  );

  const runShellEscape = useCallback(
    async (cmd: string): Promise<void> => {
      if (!BASH_BRIDGE.run) {
        setStatusMessage('shell bridge not initialised');
        return;
      }
      const echoId = nextId();
      const echoAgentColor = AGENT_COLOR_BRIDGE.get?.(session);
      appendRows([{ kind: 'message', id: echoId, role: 'user', content: `!${cmd}`, agentColor: echoAgentColor }]);
      await session.append(
        newMessage({
          role: 'user',
          content: `!${cmd}`,
          meta: { source: 'mu-coding', visibility: 'both' },
        }),
      );
      const controller = new AbortController();
      const result = await BASH_BRIDGE.run(cmd, controller.signal);
      const body = result.content || '(no output)';
      const formatted = result.error
        ? `<shell-output exit="error">\n${body}\n</shell-output>`
        : `<shell-output>\n${body}\n</shell-output>`;
      await session.append(
        newMessage({
          role: 'system',
          content: formatted,
          meta: { source: 'mu-coding', visibility: 'both' },
        }),
      );
    },
    [session, nextId, appendRows],
  );

  const submitRef = useRef<((raw: string) => Promise<void>) | null>(null);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: input dispatch branches on parsed type
  const submit = async (raw: string): Promise<void> => {
    if (pendingApproval || sessionsPickerOpen || modelPickerOpen) return;
    if (palette.showCommandPalette && palette.commandItems.length > 0) {
      const picked = palette.commandItems[palette.paletteCursor] ?? palette.commandItems[0];
      if (picked) {
        setInput('');
        await dispatchCommand(picked.id.slice(1), '');
        return;
      }
    }

    const parsed = parseInput(raw);
    if (parsed.type === 'empty') return;
    setInput('');

    if (parsed.type === 'shell') {
      await runShellEscape(parsed.cmd);
      return;
    }

    if (parsed.type === 'command') {
      const handled = await dispatchCommand(parsed.name, parsed.args);
      if (handled) return;
    }

    if (parsed.type !== 'message') return;
    const text = parsed.text;

    if (busy) {
      const queuedId = nextId();
      queueRef.current.push({ id: queuedId, text });
      setQueuedView((q) => [...q, { id: queuedId, text }]);
      return;
    }

    const directSubAgent = parseDirectSubAgent(text, agentsHandle);
    if (directSubAgent?.task === '') {
      setInput(`@${directSubAgent.agentName} `);
      setStatusMessage('subagent requires a task');
      return;
    }
    if (directSubAgent) {
      const turnAgentColor = AGENT_COLOR_BRIDGE.get?.(session);
      appendRows([{ kind: 'message', id: nextId(), role: 'user', content: text, agentColor: turnAgentColor }]);
      setStatusMessage(null);
      const result = await agentsHandle?.runSubAgent(session, directSubAgent.agentName, directSubAgent.task);
      if (result) {
        await runMessageTurn(
          newMessage({
            role: 'user',
            content: formatSubAgentResultForParent(result, directSubAgent.task),
            meta: { source: 'mu-agents-subagent', visibility: 'llm', transient: true },
          }),
        );
      }
      return;
    }

    const turnAgentColor = AGENT_COLOR_BRIDGE.get?.(session);
    appendRows([{ kind: 'message', id: nextId(), role: 'user', content: text, agentColor: turnAgentColor }]);

    await runTurn(text);
  };
  submitRef.current = submit;

  const handlePromptKey = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyboard dispatch must handle many keys
    (ch: string, key: Key): boolean => {
      if (pendingApproval || sessionsPickerOpen || modelPickerOpen) return false;
      if (handleSubAgentNavKey(ch, key)) return true;
      if (key.ctrl && ch === 'c') {
        if (busy) {
          queueRef.current.length = 0;
          setQueuedView([]);
          session.abort();
          return true;
        }
        if (input.length > 0) {
          setInput('');
          return true;
        }
        process.exit(0);
      }
      if (key.escape) {
        if (palette.showCommandPalette) {
          setInput('');
          return true;
        }
        if (mentionPalette.showMentionPalette) {
          setInput('');
          return true;
        }
        if (busy) {
          queueRef.current.length = 0;
          setQueuedView([]);
          session.abort();
          return true;
        }
        return true;
      }
      if (palette.paletteOpen) {
        if (key.upArrow) {
          palette.setPaletteCursor(
            (palette.paletteCursor - 1 + palette.commandItems.length) % palette.commandItems.length,
          );
          return true;
        }
        if (key.downArrow || key.tab) {
          palette.setPaletteCursor((palette.paletteCursor + 1) % palette.commandItems.length);
          return true;
        }
        if (key.return && !(key.shift || key.ctrl || key.meta)) {
          const picked = palette.commandItems[palette.paletteCursor] ?? palette.commandItems[0];
          if (picked) {
            setInput('');
            void dispatchCommand(picked.id.slice(1), '');
          }
          return true;
        }
      }
      if (mentionPalette.mentionPaletteOpen) {
        if (key.upArrow) {
          mentionPalette.setMentionCursor(
            (mentionPalette.mentionCursor - 1 + mentionPalette.mentionItems.length) %
              mentionPalette.mentionItems.length,
          );
          return true;
        }
        if (key.downArrow || key.tab) {
          mentionPalette.setMentionCursor((mentionPalette.mentionCursor + 1) % mentionPalette.mentionItems.length);
          return true;
        }
        if (key.return && !(key.shift || key.ctrl || key.meta)) {
          const picked = mentionPalette.mentionItems[mentionPalette.mentionCursor] ?? mentionPalette.mentionItems[0];
          const value = typeof picked?.value === 'string' ? picked.value : picked?.id.slice(1);
          if (value) setInput(`@${value} `);
          return true;
        }
      }
      for (const kb of TUI_KEYBINDS.list()) {
        if (kb.when && !kb.when()) continue;
        if (!keyMatches(kb.chord, ch, key)) continue;
        if (kb.run() !== false) return true;
      }
      return false;
    },
    [
      busy,
      dispatchCommand,
      handleSubAgentNavKey,
      input,
      mentionPalette,
      palette,
      pendingApproval,
      session,
      sessionsPickerOpen,
      modelPickerOpen,
    ],
  );

  useEffect(() => {
    if (busy) return;
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift();
    if (!next) return;
    setQueuedView((q) => q.slice(1));
    queueMicrotask(() => {
      void submitRef.current?.(next.text);
    });
  }, [busy]);

  const ctxSnapshot = CTX_BRIDGE.bySession.get(currentSessionId);
  const transcriptRows = focusedSubAgent ? focusedSubAgent.rows : history;
  const transcriptStreaming = focusedSubAgent ? focusedSubAgent.streaming : streaming;
  const transcriptReasoning = focusedSubAgent ? '' : streamingReasoning;
  const transcriptQueue = focusedSubAgent ? [] : queuedView;
  const assistantLineOverride = focusedSubAgent ? <SubAgentAssistantLabel feed={focusedSubAgent} /> : undefined;
  const promptPaletteOpen = palette.paletteOpen || mentionPalette.mentionPaletteOpen;
  const promptDropdown = palette.showCommandPalette ? (
    <AutocompleteDropdown items={palette.commandItems} cursor={palette.paletteCursor} />
  ) : mentionPalette.showMentionPalette ? (
    <AutocompleteDropdown items={mentionPalette.mentionItems} cursor={mentionPalette.mentionCursor} title="Subagents" />
  ) : null;
  const promptInput = focusedSubAgent ? null : (
    <PromptInput
      value={input}
      onChange={setInput}
      onSubmit={submit}
      onKey={handlePromptKey}
      focus={!(sessionsPickerOpen || modelPickerOpen)}
      paletteActive={promptPaletteOpen}
      dropdown={promptDropdown}
    />
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <SubAgentBanner feeds={subAgentFeeds} focusedRunId={focusedSubAgentRunId} navPrefix={navPrefix} />
      <TranscriptView
        rows={transcriptRows}
        streaming={transcriptStreaming}
        streamingReasoning={transcriptReasoning}
        queuedView={transcriptQueue}
        scrollable={!(palette.showCommandPalette || mentionPalette.showMentionPalette || navPrefix)}
      />
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
      <AssistantLine override={assistantLineOverride} />
      {pendingApproval ? (
        <ApprovalModal
          request={pendingApproval.request}
          onDecide={(decision) => {
            pendingApproval.decide(decision);
            setPendingApproval(null);
          }}
        />
      ) : (
        promptInput
      )}
      <StatusBarContent
        busy={busy}
        queueLength={queuedView.length}
        ctxSnapshot={ctxSnapshot}
        ctxTotal={CTX_BRIDGE.totalForModel}
      />
      <ExitOnSignal onExit={onExit} />
    </Box>
  );
}

function subAgentStatusColor(status: SubAgentFeed['status']): string {
  if (status === 'error') return 'red';
  if (status === 'completed') return 'green';
  return 'yellow';
}

function formatSubAgentResultForParent(result: SubAgentResult, task: string): string {
  const tag = result.error ? 'task_error' : 'task_result';
  const text = result.error || result.content || '';
  return [
    `subagent: ${result.agentName}`,
    `task_id: ${result.runId}`,
    `task: ${task}`,
    '',
    `<${tag}>`,
    text,
    `</${tag}>`,
  ].join('\n');
}

function parseDirectSubAgent(
  text: string,
  agentsHandle: AgentsHandle | undefined,
): { agentName: string; task: string } | null {
  if (!agentsHandle) return null;
  const knownAgents = new Set(agentsHandle.list().map((agent) => agent.name));
  const parsed = parseMention(text, knownAgents);
  if (!parsed.mention) return null;
  const agent = agentsHandle.get(parsed.mention.agent);
  if (agent?.kind !== 'subagent') return null;
  return { agentName: parsed.mention.agent, task: parsed.mention.task };
}

function SubAgentAssistantLabel({ feed }: { feed: SubAgentFeed }): React.ReactElement {
  return (
    <>
      <Text color="cyan" bold={true}>
        {feed.agentName}
      </Text>{' '}
      <Text color={subAgentStatusColor(feed.status)}>{feed.status}</Text>
    </>
  );
}

function ExitOnSignal({ onExit }: { onExit: () => void }): null {
  const { exit } = useApp();
  useEffect(() => {
    EXIT_BRIDGE.fn = exit;
    return () => {
      if (EXIT_BRIDGE.fn === exit) EXIT_BRIDGE.fn = null;
    };
  }, [exit]);
  void onExit;
  return null;
}
