/**
 * SubagentBrowserPanel — read-only view of a single subagent run.
 *
 * Replaces the chat body when `viewMode.kind === 'subagent'`:
 *  - Top banner: session title · agent name · status (agent colour).
 *  - Body: full-fidelity `MessageView` over the run's transcript so every
 *    nested tool call / reasoning block / output renders identically to
 *    the parent chat.
 *  - Status bar: subagent-specific segments (i/N, tool calls, elapsed).
 *  - No input box — the panel is read-only; the user navigates via
 *    `Ctrl+X →/←` or returns to chat with `Esc` / `Ctrl+X ↑`.
 */

import { Box, type DOMElement as InkDOMElement, Text } from 'ink';
import type { SubagentRun } from 'mu-agents';
import type { ChatMessage } from 'mu-core';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useScroll } from '../../hooks/useScroll';
import { useMeasure, useTerminalSize } from '../../hooks/useTerminal';
import { MessageView } from '../messageView';
import { StatusBar, type StatusBarSegment } from '../statusBar';

interface SubagentBrowserPanelProps {
  run: SubagentRun;
  position: { index: number; total: number } | null;
  /** Display title for the parent session (e.g. session file stem). */
  sessionTitle?: string;
}

const STATUS_LABEL: Record<SubagentRun['status'], string> = {
  running: 'running…',
  done: 'done',
  error: 'error',
  aborted: 'aborted',
};

function statusColor(status: SubagentRun['status']): string | undefined {
  switch (status) {
    case 'running':
      return 'cyan';
    case 'done':
      return 'green';
    case 'error':
      return 'red';
    case 'aborted':
      return 'yellow';
    default:
      return undefined;
  }
}

function formatElapsed(run: SubagentRun): string {
  const end = run.finishedAt ?? Date.now();
  const ms = Math.max(0, end - run.startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, '0')}s`;
}

function countToolCalls(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.toolCalls?.length) n += m.toolCalls.length;
  }
  return n;
}

/**
 * Subscribe to elapsed time so the live "running…" status keeps updating
 * even when no new tokens arrive. Refreshes every second; the timer
 * shuts off as soon as the run has a `finishedAt`.
 */
function useTickWhileRunning(run: SubagentRun): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (run.finishedAt) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run.finishedAt]);
}

export function SubagentBrowserPanel({ run, position, sessionTitle }: SubagentBrowserPanelProps) {
  const theme = useTheme();
  const { width, height } = useTerminalSize();
  const viewRef = useRef<InkDOMElement>(null);
  const contentRef = useRef<InkDOMElement>(null);
  const measureKey = useMemo(
    () => `${run.id}|${run.messages.length}|${run.status}`,
    [run.id, run.messages.length, run.status],
  );
  const { viewHeight, contentHeight } = useMeasure(viewRef, contentRef, measureKey);
  const { scrollOffset } = useScroll(contentHeight, viewHeight);

  useTickWhileRunning(run);

  const segments: StatusBarSegment[] = [
    ...(position ? [{ text: `subagent ${position.index}/${position.total}`, align: 'left' as const, dim: true }] : []),
    { text: `tool calls: ${countToolCalls(run.messages)}`, dim: true },
    { text: formatElapsed(run), dim: true },
    { text: 'Esc · chat | Ctrl+X →/← cycle', dim: true },
  ];

  const banner = (
    <Box flexShrink={0} paddingX={1} borderStyle="single" borderColor={run.agentColor ?? theme.status.separator}>
      <Box flexGrow={1}>
        <Text color={run.agentColor} bold={true}>
          ↳ {run.agentName}
        </Text>
        <Text dimColor={true}>{sessionTitle ? `  ·  ${sessionTitle}` : ''}</Text>
        <Text dimColor={true}>{`  ·  ${run.id}`}</Text>
      </Box>
      <Text color={statusColor(run.status)} bold={true}>
        {STATUS_LABEL[run.status]}
      </Text>
    </Box>
  );

  return (
    <Box flexDirection="column" height={height} width={width}>
      {banner}
      <MessageView
        viewRef={viewRef}
        contentRef={contentRef}
        messages={run.messages}
        streaming={run.status === 'running'}
        stream={{ text: '', reasoning: '', totalTokens: 0, cachedTokens: 0 }}
        error={run.error ?? null}
        scrollOffset={scrollOffset}
        viewHeight={viewHeight}
        contentHeight={contentHeight}
      />
      <StatusBar segments={segments} />
    </Box>
  );
}

/** Helper type used by `ChatPanelBody` when constructing the panel. */
export type SubagentBrowserPanelComponent = typeof SubagentBrowserPanel;

/** Wrap a `RefObject<DOMElement>` cast for callers that need it. */
export type _SubagentBrowserRef = RefObject<InkDOMElement | null>;
