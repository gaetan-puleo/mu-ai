import { debugLog, type Message, newMessage, type Session, type SessionEvent } from 'mu-core';
import React from 'react';
import { rowsFromAppendedMessage, rowsFromAssistantMessage } from '../../logic/transcriptBuilder';
import { ACTIVE_MODEL_BRIDGE, CTX_BRIDGE, MODEL_CHANGE_BRIDGE } from '../bridges';
import { TUI_SLOTS } from '../primitives';
import { insertToolResultRow, type TranscriptRow, toolResultRowFromMessage } from '../types';

const { useCallback, useEffect, useRef, useState } = React;

export interface MessageStreamHandle {
  busy: boolean;
  history: TranscriptRow[];
  streaming: string;
  streamingReasoning: string;
  appendRows: (rows: TranscriptRow[]) => void;
  runTurn: (text: string) => Promise<void>;
  runMessageTurn: (message: Message) => Promise<void>;
  nextId: () => string;
  clearStreaming: () => void;
  setHistory: React.Dispatch<React.SetStateAction<TranscriptRow[]>>;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: hook aggregates streaming state + event listener
export function useMessageStream(session: Session, currentSessionId: string): MessageStreamHandle {
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<TranscriptRow[]>([]);
  const [streaming, setStreaming] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const idRef = useRef(0);

  const nextId = useCallback((): string => `m-${++idRef.current}`, []);

  const appendRows = useCallback((rows: TranscriptRow[]) => {
    setHistory((h) => [...h, ...rows]);
  }, []);

  const clearStreaming = useCallback(() => {
    setStreaming('');
    setStreamingReasoning('');
  }, []);

  const runMessageTurn = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming event dispatch is inherently branching
    async (userMsg: Message) => {
      setBusy(true);
      const turnModel = ACTIVE_MODEL_BRIDGE.value || undefined;
      debugLog('tui', 'submit', { textLen: userMsg.content.length, model: turnModel });
      let lastStreamLen = 0;
      let lastReasoningLen = 0;

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
            const prev = CTX_BRIDGE.bySession.get(currentSessionId) ?? {};
            CTX_BRIDGE.bySession.set(currentSessionId, {
              ...prev,
              used: ev.usage.promptTokens,
              cached: ev.usage.cachedPromptTokens,
              total: CTX_BRIDGE.totalForModel ?? prev.total,
            });
            TUI_SLOTS.notify();
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
            const additions = rowsFromAssistantMessage(ev.message);
            if (additions.length > 0) appendRows(additions);
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
              appendRows([
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
    },
    [session, currentSessionId, appendRows, nextId],
  );

  const runTurn = useCallback(
    async (text: string) => {
      await runMessageTurn(newMessage({ role: 'user', content: text }));
    },
    [runMessageTurn],
  );

  useEffect(() => {
    const off = session.on((ev: SessionEvent) => {
      if (ev.type !== 'message_appended') return;
      if (ev.message.role === 'tool') {
        const row = toolResultRowFromMessage(ev.message);
        if (row) setHistory((h) => insertToolResultRow(h, row));
        return;
      }
      const rows = rowsFromAppendedMessage(ev.message);
      if (rows.length > 0) appendRows(rows);
    });
    return off;
  }, [session, appendRows]);

  return {
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
  };
}
