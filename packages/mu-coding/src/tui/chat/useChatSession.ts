import { type PluginRegistry, runTransformUserInputHooks } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useCallback, useEffect } from 'react';
import type { HostMessageBus } from '../../runtime/messageBus';
import type { AttachmentState } from './useAttachment';
import { useSessionPersistence } from './useSessionPersistence';
import { type StreamState, useStreamConsumer } from './useStreamConsumer';

export type { StreamState } from './useStreamConsumer';

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
  config: ProviderConfig;
  currentModel: string;
  attachment: AttachmentState;
  controllerRef: React.RefObject<AbortController | null>;
  initialMessages?: ChatMessage[];
  registry: PluginRegistry;
  messageBus?: HostMessageBus;
}

/**
 * Build the list of messages to feed the agent for this turn:
 *   - existing transcript
 *   - any messages plugins queued via `MessageBus.injectNext`
 *   - the user's message itself
 *
 * Injected messages are persisted just like the user message so the next
 * resume sees the same context.
 */
function buildTurnMessages(prior: ChatMessage[], injections: ChatMessage[], userMsg: ChatMessage): ChatMessage[] {
  return [...prior, ...injections, userMsg];
}

/**
 * Treat a message as "synthetic" when it carries plugin metadata not produced
 * by the LLM (custom renderer key, hidden flag, plugin-private meta bag).
 * Synthetic messages are preserved when the agent streams a fresh transcript
 * so that `MessageBus.append`-ed entries (e.g. agent-switch banners) don't
 * vanish on the next `messages` event.
 */
function isSynthetic(msg: ChatMessage): boolean {
  return Boolean(msg.customType) || Boolean(msg.display?.hidden) || Boolean(msg.meta);
}

/**
 * Merge agent-produced messages with plugin-synthetic ones already in state.
 * The agent's snapshot is authoritative for everything it knows about; we
 * splice synthetic entries back in at the same trailing position they
 * originally occupied (last-write semantics — the cluster is appended at
 * the end of the array).
 */
function mergeWithSynthetic(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const synthetic = prev.filter(isSynthetic);
  if (synthetic.length === 0) return next;
  return [...next, ...synthetic];
}

/**
 * Wire the host MessageBus to React state: keep `bus.get()` in sync with the
 * live transcript and let plugins call `bus.append(...)` from outside the
 * tree. The two effects are split so the appender wiring only re-runs when
 * `setMessages` changes (which is stable in practice).
 */
function useMessageBusWiring(
  messageBus: HostMessageBus | undefined,
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): void {
  useEffect(() => {
    messageBus?.setMessages(messages);
  }, [messageBus, messages]);

  useEffect(() => {
    if (!messageBus) return;
    messageBus.setAppender((message) => {
      setMessages((prev) => [...prev, message]);
    });
    return () => {
      messageBus.setAppender(null);
    };
  }, [messageBus, setMessages]);
}

interface OnSendDeps {
  consumer: ReturnType<typeof useStreamConsumer>;
  messages: ChatMessage[];
  config: ProviderConfig;
  currentModel: string;
  attachment: AttachmentState;
  controllerRef: React.RefObject<AbortController | null>;
  registry: PluginRegistry;
  messageBus?: HostMessageBus;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  appendHistory: (text: string) => void;
  saveCurrent: (messages: ChatMessage[]) => void;
}

function useOnSend(deps: OnSendDeps): (text: string) => Promise<void> {
  const {
    consumer,
    messages,
    config,
    currentModel,
    attachment,
    controllerRef,
    registry,
    messageBus,
    setMessages,
    appendHistory,
    saveCurrent,
  } = deps;
  return useCallback(
    async (text: string) => {
      if (consumer.streaming) return;

      // Let plugins transform / intercept the input before constructing a user
      // message. `intercept` short-circuits the LLM call entirely; plugins
      // typically pair this with `messageBus.append` to surface a reply.
      const transform = await runTransformUserInputHooks(registry.getHooks(), text);
      if (transform.kind === 'intercept') return;
      const finalText = transform.kind === 'transform' ? transform.text : text;

      const userMsg: ChatMessage = {
        role: 'user',
        content: finalText,
        ...(attachment.attachment ? { images: [attachment.attachment] } : {}),
      };
      const injections = messageBus?.drainNext() ?? [];
      // Build the turn payload exactly once so the React update and the
      // agent input agree on what was sent — avoids divergence with the
      // closure-captured `messages` snapshot vs. the most recent state.
      const turnMessages = buildTurnMessages(messages, injections, userMsg);

      setMessages(turnMessages);
      appendHistory(text);
      attachment.clear();

      const controller = new AbortController();
      controllerRef.current = controller;

      // Use a merge wrapper so plugin-injected synthetic messages (e.g.
      // agent-switch banners pushed via `MessageBus.append`) survive each
      // `messages` event from the agent. Without this, the agent's snapshot
      // overwrites the array and synthetic entries silently vanish.
      const onMessagesMerged = (next: ChatMessage[]): void => {
        setMessages((prev) => mergeWithSynthetic(prev, next));
      };

      try {
        const final = await consumer.runStream(
          turnMessages,
          config,
          currentModel,
          controller.signal,
          registry,
          onMessagesMerged,
        );
        if (final) saveCurrent(final);
      } finally {
        controllerRef.current = null;
      }
    },
    [
      consumer.streaming,
      consumer.runStream,
      messages,
      config,
      currentModel,
      attachment,
      controllerRef,
      registry,
      messageBus,
      setMessages,
      appendHistory,
      saveCurrent,
    ],
  );
}

/**
 * Top-level chat-session hook. Composes:
 *  - `useSessionPersistence` — transcript, history, save path
 *  - `useStreamConsumer`     — in-flight tokens, usage totals, error
 *
 * Provides the `onSend` glue that wires user input through the agent.
 */
export function useChatSession(deps: SessionDeps): ChatSessionState {
  const { config, currentModel, attachment, controllerRef, initialMessages, registry, messageBus } = deps;
  const persistence = useSessionPersistence(initialMessages);
  const consumer = useStreamConsumer();
  const { messages, setMessages, appendHistory, saveCurrent } = persistence;

  useMessageBusWiring(messageBus, messages, setMessages);

  const onSend = useOnSend({
    consumer,
    messages,
    config,
    currentModel,
    attachment,
    controllerRef,
    registry,
    messageBus,
    setMessages,
    appendHistory,
    saveCurrent,
  });

  const onNew = useCallback(() => {
    persistence.onNew();
    consumer.resetSession();
    attachment.clear();
  }, [persistence.onNew, consumer.resetSession, attachment]);

  const onLoadSession = useCallback(
    (path: string) => {
      persistence.onLoadSession(path);
      consumer.resetSession();
    },
    [persistence.onLoadSession, consumer.resetSession],
  );

  return {
    messages: persistence.messages,
    streaming: consumer.streaming,
    error: consumer.error,
    stream: consumer.stream,
    inputHistory: persistence.inputHistory,
    onSend,
    onNew,
    onLoadSession,
  };
}
