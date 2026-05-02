import type { ChatMessage, ProviderConfig, Session } from 'mu-core';
import { type PluginRegistry, runDecorateMessageHooks, runTransformUserInputHooks } from 'mu-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostMessageBus } from '../../runtime/messageBus';
import type { AttachmentState } from './useAttachment';
import { useSessionPersistence } from './useSessionPersistence';

export interface StreamState {
  text: string;
  reasoning: string;
  totalTokens: number;
  cachedTokens: number;
}

const EMPTY_STREAM: StreamState = { text: '', reasoning: '', totalTokens: 0, cachedTokens: 0 };

export interface ChatSessionState {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  stream: StreamState;
  inputHistory: string[];
  onSend: (text: string) => Promise<void>;
  onNew: () => void;
  onLoadSession: (path: string) => void;
}

interface SessionDeps {
  /**
   * mu-core Session instance owned by the host. Authoritative for the
   * transcript — this hook only mirrors it into React state and writes
   * persistence on each message_changed event.
   */
  session: Session;
  /** Provider config used as `runTurn` override (model lookup happens here). */
  config: ProviderConfig;
  /** Currently selected model id (may shift across sends). */
  currentModel: string;
  attachment: AttachmentState;
  controllerRef: React.RefObject<AbortController | null>;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  messageBus?: HostMessageBus;
}

/**
 * Wire the host MessageBus to the Session: bus.append flows through
 * `session.appendSynthetic` so every subscriber (TUI, broadcaster) sees the
 * same change. `bus.get()` mirrors the live transcript.
 */
function useMessageBusWiring(messageBus: HostMessageBus | undefined, messages: ChatMessage[], session: Session): void {
  useEffect(() => {
    messageBus?.setMessages(messages);
  }, [messageBus, messages]);

  useEffect(() => {
    if (!messageBus) return;
    messageBus.setAppender((message) => {
      session.appendSynthetic(message);
    });
    return () => {
      messageBus.setAppender(null);
    };
  }, [messageBus, session]);
}

interface SubscriptionDeps {
  session: Session;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setStream: React.Dispatch<React.SetStateAction<StreamState>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  saveCurrent: (messages: ChatMessage[]) => void;
}

/**
 * Subscribe React state to mu-core Session events. Session is authoritative;
 * this hook only mirrors. Persistence is driven from the same stream so disk
 * writes are guaranteed to match what the user sees, but writes are
 * coalesced to once per `stream_ended` to keep tool-heavy turns light on I/O.
 */
/**
 * Build the event handler. Extracted so the cognitive complexity of the
 * dispatch lives outside the React effect closure (the effect itself is
 * just `session.subscribe(handler)`).
 */
function makeSessionEventHandler(
  deps: SubscriptionDeps,
  lastMessagesRef: React.MutableRefObject<ChatMessage[]>,
): (event: import('mu-core').SessionEvent) => void {
  const { setMessages, setStream, setStreaming, setError, saveCurrent } = deps;
  return (event) => {
    if (event.type === 'messages_changed') {
      lastMessagesRef.current = event.messages;
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
      if (lastMessagesRef.current.length > 0) saveCurrent(lastMessagesRef.current);
      return;
    }
    if (event.type === 'usage') {
      setStream((s) => ({
        ...s,
        totalTokens: s.totalTokens + event.totalTokens,
        cachedTokens: s.cachedTokens + event.cachedTokens,
      }));
      return;
    }
    if (event.type === 'error') {
      setError(event.message);
    }
  };
}

function useSessionSubscription(deps: SubscriptionDeps): void {
  const { session, setMessages, setStream, setStreaming, setError, saveCurrent } = deps;
  // The "last completed transcript" buffer survives effect re-subscriptions
  // (e.g. if `saveCurrent` identity ever changes mid-stream). Without a ref
  // we'd lose the in-flight save target on the next deps change.
  const lastMessagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    const handler = makeSessionEventHandler(
      { session, setMessages, setStream, setStreaming, setError, saveCurrent },
      lastMessagesRef,
    );
    return session.subscribe(handler);
  }, [session, setMessages, setStream, setStreaming, setError, saveCurrent]);
}

interface OnSendDeps {
  session: Session;
  config: ProviderConfig;
  currentModel: string;
  attachment: AttachmentState;
  controllerRef: React.RefObject<AbortController | null>;
  registry: PluginRegistry;
  messageBus?: HostMessageBus;
  appendHistory: (text: string) => void;
  streaming: boolean;
}

function useOnSend(deps: OnSendDeps): (text: string) => Promise<void> {
  const { session, config, currentModel, attachment, controllerRef, registry, messageBus, appendHistory, streaming } =
    deps;
  return useCallback(
    async (text: string) => {
      if (streaming) return;

      const transform = await runTransformUserInputHooks(registry.getHooks(), text);
      if (transform.kind === 'intercept') return;
      const finalText = transform.kind === 'transform' ? transform.text : text;

      const userMsg: ChatMessage = await runDecorateMessageHooks(registry.getHooks(), {
        role: 'user',
        content: finalText,
        ...(attachment.attachment ? { images: [attachment.attachment] } : {}),
      });

      const injections = messageBus?.drainNext() ?? [];
      for (const inj of injections) session.queueForNextTurn(inj);

      appendHistory(text);
      attachment.clear();

      const controller = new AbortController();
      controllerRef.current = controller;
      controller.signal.addEventListener('abort', () => session.abort(), { once: true });

      try {
        await session.runTurn({
          userMessage: userMsg,
          config,
          model: currentModel,
          registry,
        });
      } finally {
        controllerRef.current = null;
      }
    },
    [streaming, session, config, currentModel, attachment, controllerRef, registry, messageBus, appendHistory],
  );
}

/**
 * Top-level chat-session hook. Composes:
 *  - mu-core `Session` — single source of truth for the transcript
 *  - `useSessionPersistence` — disk write + history + session paths
 *
 * The hook is purely reactive: it subscribes to session events and exposes
 * the resulting state, plus thin wrappers around `session.runTurn` /
 * `session.setMessages` for user actions.
 */
export function useChatSession(deps: SessionDeps): ChatSessionState {
  const { session, config, currentModel, attachment, controllerRef, initialMessages, registry, messageBus } = deps;
  const persistence = useSessionPersistence(initialMessages);
  const { appendHistory, saveCurrent, resetForNew, loadFromPath } = persistence;

  // Initial seed: feed any persisted messages into the session once.
  // The session subscription below will then mirror them into React state.
  useEffect(() => {
    if (initialMessages?.length) session.setMessages(initialMessages);
    // Run once per session instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, initialMessages?.length, initialMessages]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);

  useMessageBusWiring(messageBus, messages, session);
  useSessionSubscription({ session, setMessages, setStream, setStreaming, setError, saveCurrent });

  const onSend = useOnSend({
    session,
    config,
    currentModel,
    attachment,
    controllerRef,
    registry,
    messageBus,
    appendHistory,
    streaming,
  });

  const onNew = useCallback(() => {
    // Abort any in-flight turn *before* rotating the session path.
    // Without this, the streaming `runTurn` keeps emitting `messages_changed`
    // events that are saved to the newly-rotated path via `stream_ended`,
    // mixing the old transcript into the brand-new file.
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    resetForNew();
    // `session.setMessages([])` emits `messages_changed` which the
    // subscription mirrors into React state, so we don't double-write here.
    session.setMessages([]);
    setStream(EMPTY_STREAM);
    setError(null);
    attachment.clear();
  }, [resetForNew, session, attachment, controllerRef]);

  const onLoadSession = useCallback(
    (path: string) => {
      const loaded = loadFromPath(path);
      if (loaded.length === 0) return;
      // Abort any in-flight turn before replacing the transcript, for the
      // same reason as onNew above.
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
      // setMessages emits messages_changed → React state mirrors it.
      session.setMessages(loaded);
      setStream(EMPTY_STREAM);
      setError(null);
    },
    [loadFromPath, session, controllerRef],
  );

  return {
    messages,
    streaming,
    error,
    stream,
    inputHistory: persistence.inputHistory,
    onSend,
    onNew,
    onLoadSession,
  };
}
