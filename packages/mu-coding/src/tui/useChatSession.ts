import { type AgentEvent, type PluginRegistry, runAgent } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useCallback, useRef, useState } from 'react';
import { generateSessionPath, loadSession, saveSession } from '../session';
import type { AttachmentState } from './useChatUI';

export interface StreamState {
  text: string;
  reasoning: string;
  totalTokens: number;
  tps: number;
}

const EMPTY_STREAM: StreamState = { text: '', reasoning: '', totalTokens: 0, tps: 0 };

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

function applyEvent(prev: StreamState, event: AgentEvent, tps: number): StreamState {
  switch (event.type) {
    case 'content':
      return { ...prev, text: event.text, tps };
    case 'reasoning':
      return { ...prev, reasoning: event.text, tps };
    case 'usage':
      return { ...prev, totalTokens: prev.totalTokens + event.totalTokens };
    case 'turn_end':
      return { ...prev, text: '', reasoning: '' };
    default:
      return prev;
  }
}

async function consumeAgent(
  events: AsyncGenerator<AgentEvent>,
  onStream: (updater: (prev: StreamState) => StreamState) => void,
  onMessages: (messages: ChatMessage[]) => void,
): Promise<ChatMessage[] | null> {
  let final: ChatMessage[] | null = null;
  const start = Date.now();
  let tokenCount = 0;

  for await (const event of events) {
    if (event.type === 'content' || event.type === 'reasoning') {
      tokenCount++;
      const elapsed = (Date.now() - start) / 1000;
      const tps = elapsed > 0.5 ? Math.round(tokenCount / elapsed) : 0;
      onStream((prev) => applyEvent(prev, event, tps));
    } else if (event.type === 'messages') {
      final = event.messages;
      onMessages(event.messages);
    } else {
      onStream((prev) => applyEvent(prev, event, 0));
    }
  }
  return final;
}

export function useChatSession(deps: SessionDeps): ChatSessionState {
  const { config, currentModel, attachment, controllerRef, initialMessages, registry } = deps;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);
  const [inputHistory, setInputHistory] = useState<string[]>(
    initialMessages?.filter((m) => m.role === 'user').map((m) => m.content) ?? [],
  );
  const sessionPathRef = useRef(generateSessionPath());

  const reset = useCallback(() => {
    setStream(EMPTY_STREAM);
    setError(null);
  }, []);

  const onSend = useCallback(
    async (text: string) => {
      if (streaming) {
        return;
      }
      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        ...(attachment.attachment ? { images: [attachment.attachment] } : {}),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputHistory((prev) => [...prev, text]);
      reset();
      setStreaming(true);
      attachment.clear();

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const final = await consumeAgent(
          runAgent([...messages, userMsg], config, currentModel, controller.signal, registry),
          setStream,
          setMessages,
        );
        if (final) {
          saveSession(sessionPathRef.current, final);
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        setStreaming(false);
        controllerRef.current = null;
        if (!controller.signal.aborted) {
          setStream((s) => ({ ...s, text: '', reasoning: '' }));
        }
      }
    },
    [streaming, messages, config, currentModel, attachment, controllerRef, reset, registry],
  );

  const onNew = useCallback(() => {
    setMessages([]);
    reset();
    sessionPathRef.current = generateSessionPath();
    attachment.clear();
  }, [attachment, reset]);

  const onLoadSession = useCallback(
    (path: string) => {
      const msgs = loadSession(path);
      if (msgs.length > 0) {
        setMessages(msgs);
        sessionPathRef.current = path;
        reset();
      }
    },
    [reset],
  );

  return { messages, streaming, error, stream, inputHistory, onSend, onNew, onLoadSession };
}
