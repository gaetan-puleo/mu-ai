import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useCallback } from 'react';
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
}

/**
 * Top-level chat-session hook. Composes:
 *  - `useSessionPersistence` — transcript, history, save path
 *  - `useStreamConsumer`     — in-flight tokens, tps, error
 *
 * Provides the `onSend` glue that wires user input through the agent.
 */
export function useChatSession(deps: SessionDeps): ChatSessionState {
  const { config, currentModel, attachment, controllerRef, initialMessages, registry } = deps;
  const persistence = useSessionPersistence(initialMessages);
  const consumer = useStreamConsumer();
  const { messages, setMessages, appendHistory, saveCurrent } = persistence;

  const onSend = useCallback(
    async (text: string) => {
      if (consumer.streaming) {
        return;
      }
      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        ...(attachment.attachment ? { images: [attachment.attachment] } : {}),
      };
      setMessages((prev) => [...prev, userMsg]);
      appendHistory(text);
      attachment.clear();

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const final = await consumer.runStream(
          [...messages, userMsg],
          config,
          currentModel,
          controller.signal,
          registry,
          setMessages,
        );
        if (final) {
          saveCurrent(final);
        }
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
      setMessages,
      appendHistory,
      saveCurrent,
    ],
  );

  const onNew = useCallback(() => {
    persistence.onNew();
    consumer.resetError();
    attachment.clear();
  }, [persistence.onNew, consumer.resetError, attachment]);

  const onLoadSession = useCallback(
    (path: string) => {
      persistence.onLoadSession(path);
      consumer.resetError();
    },
    [persistence.onLoadSession, consumer.resetError],
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
