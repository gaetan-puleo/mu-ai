import type { ChatMessage, ProviderConfig, Session, SubmitTextInput, SubmitTextResult } from 'mu-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentState } from './useAttachment';

export interface StreamState {
  text: string;
  reasoning: string;
  totalTokens: number;
  promptTokens: number;
  cachedTokens: number;
}

const EMPTY_STREAM: StreamState = { text: '', reasoning: '', totalTokens: 0, promptTokens: 0, cachedTokens: 0 };

export interface ChatSessionState {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  stream: StreamState;
  inputHistory: string[];
  onSend: (text: string) => Promise<void>;
  /** Called by useChat for /new — resets local state. */
  resetMessages: () => void;
  onNew: () => void;
  onLoadSession: (sessionId: string) => void;
  onCompact: () => Promise<void>;
}

interface SessionDeps {
  session: Session;
  config: ProviderConfig;
  currentModel: string;
  attachment: AttachmentState;
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>;
  initialMessages?: ChatMessage[];
}

// ─── Session event subscription ─────────────────────────────────────────────

function useSessionSubscription(
  session: Session,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setStream: React.Dispatch<React.SetStateAction<StreamState>>,
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  useEffect(() => {
    return session.subscribe((event) => {
      if (event.type === 'messages_changed') {
        setMessages(event.messages);
        return;
      }
      if (event.type === 'stream_partial') {
        setStream((s) => ({ ...s, text: event.text, reasoning: event.reasoning ?? '' }));
        return;
      }
      if (event.type === 'stream_started') {
        setStreaming(true);
        setError(null);
        return;
      }
      if (event.type === 'stream_ended') {
        setStreaming(false);
        setStream((s) => ({ ...s, text: '', reasoning: '' }));
        return;
      }
      if (event.type === 'usage') {
        setStream((s) => ({
          ...s,
          totalTokens: event.totalTokens,
          promptTokens: event.promptTokens,
          cachedTokens: event.cachedTokens,
        }));
        return;
      }
      if (event.type === 'error') {
        setError(event.message);
      }
    });
  }, [session, setMessages, setStream, setStreaming, setError]);
}

// ─── onSend ─────────────────────────────────────────────────────────────────

function useOnSend(
  session: Session,
  attachment: AttachmentState,
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>,
  currentModel: string,
  appendHistory: (text: string) => void,
  streaming: boolean,
): (text: string) => Promise<void> {
  return useCallback(
    async (text: string) => {
      if (streaming) return;
      appendHistory(text);
      const currentAttachment = attachment.attachment;
      attachment.clear();

      await submitText({
        sessionId: session.id,
        text,
        model: currentModel,
        decorateUserMessage: currentAttachment
          ? (msg: ChatMessage) => ({ ...msg, images: [currentAttachment] })
          : undefined,
      });
    },
    [streaming, session.id, attachment, submitText, currentModel, appendHistory],
  );
}

// ─── onCompact ──────────────────────────────────────────────────────────────

const COMPACT_INSTRUCTION =
  'Compact this conversation. Produce ONE concise summary that captures: ' +
  "1) the user's overall intent, 2) key decisions made, 3) files modified " +
  '(paths with line refs where relevant), 4) open tasks / next steps, and ' +
  '5) any important context the assistant should retain. Output ONLY the ' +
  'summary text — no preface, no markdown headers.';

function findLatestAssistantContent(messages: ChatMessage[], fromIndex: number): string {
  for (let i = messages.length - 1; i >= fromIndex; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.content && m.content.trim().length > 0) {
      return m.content;
    }
  }
  return '';
}

function useOnCompact(
  streaming: boolean,
  session: Session,
  submitText: (input: SubmitTextInput) => Promise<SubmitTextResult>,
  currentModel: string,
): () => Promise<void> {
  return useCallback(async () => {
    if (streaming) return;
    const before = session.getMessages();
    if (before.length === 0) return;
    const beforeCount = before.length;

    // Submit the compact instruction through the canonical path.
    // The instruction is hidden from the UI (display.hidden) but
    // reaches the LLM via submitText → runHostTurn → runTurn.
    await submitText({
      sessionId: session.id,
      text: COMPACT_INSTRUCTION,
      model: currentModel,
      decorateUserMessage: (msg) => ({ ...msg, display: { hidden: true } }),
    });
    const summary = findLatestAssistantContent(session.getMessages(), beforeCount);
    if (!summary) return;
    session.setMessages([
      { role: 'user', content: '[Conversation compacted — context below preserves prior intent and decisions]' },
      { role: 'assistant', content: summary },
    ]);
  }, [streaming, session, submitText, currentModel]);
}

// ─── Main hook ──────────────────────────────────────────────────────────────

export function useChatSession(deps: SessionDeps): ChatSessionState {
  const { session, config, currentModel, attachment, submitText, initialMessages } = deps;

  // Input history — user prompts for the up-arrow recall.
  const [inputHistory, setInputHistory] = useState<string[]>(() =>
    (initialMessages ?? []).filter((m) => m.role === 'user').map((m) => m.content),
  );
  const appendHistory = useCallback((text: string) => {
    setInputHistory((prev) => [...prev, text]);
  }, []);

  // Seed session with initial messages once.
  useEffect(() => {
    if (initialMessages?.length) session.setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, initialMessages?.length, initialMessages]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);

  useSessionSubscription(session, setMessages, setStream, setStreaming, setError);

  const onSend = useOnSend(session, attachment, submitText, currentModel, appendHistory, streaming);
  const onCompact = useOnCompact(streaming, session, submitText, currentModel);

  const resetMessages = useCallback(() => {
    session.setMessages([]);
    setStream(EMPTY_STREAM);
    setError(null);
    setInputHistory([]);
    attachment.clear();
  }, [session, attachment]);

  return {
    messages,
    streaming,
    error,
    stream,
    inputHistory,
    onSend,
    resetMessages,
    // Placeholders — useChat overwrites these with session-id-aware versions.
    onNew: resetMessages,
    onLoadSession: () => {},
    onCompact,
  };
}
