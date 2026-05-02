import { type AgentEvent, type PluginRegistry, runAgent } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useCallback, useState } from 'react';

export interface StreamState {
  text: string;
  reasoning: string;
  totalTokens: number;
  /** Cumulative tokens served from the server's prompt cache across the
   *  session. 0 when the server doesn't report cache hits. */
  cachedTokens: number;
}

const EMPTY_STREAM: StreamState = { text: '', reasoning: '', totalTokens: 0, cachedTokens: 0 };

export interface StreamConsumerState {
  streaming: boolean;
  error: string | null;
  stream: StreamState;
  /**
   * Run the agent against `messages` and stream events into local state.
   * Returns the final message array (or null if the agent didn't produce one,
   * e.g. on abort). Throws are caught and reported via `error`.
   */
  runStream: (
    messages: ChatMessage[],
    config: ProviderConfig,
    model: string,
    signal: AbortSignal,
    registry: PluginRegistry,
    onMessages: (messages: ChatMessage[]) => void,
  ) => Promise<ChatMessage[] | null>;
  resetError: () => void;
  resetSession: () => void;
}

function applyEvent(prev: StreamState, event: AgentEvent): StreamState {
  switch (event.type) {
    case 'content':
      return { ...prev, text: event.text };
    case 'reasoning':
      return { ...prev, reasoning: event.text };
    case 'usage':
      return {
        ...prev,
        totalTokens: prev.totalTokens + event.totalTokens,
        cachedTokens: prev.cachedTokens + (event.cachedTokens ?? 0),
      };
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

  for await (const event of events) {
    if (event.type === 'messages') {
      final = event.messages;
      onMessages(event.messages);
    } else {
      onStream((prev) => applyEvent(prev, event));
    }
  }
  return final;
}

/**
 * Owns the in-flight streaming view: which tokens have been received, the
 * cumulative token counter, error text, and the streaming flag. Decoupled
 * from message persistence so it can be reused by single-shot agents or
 * test harnesses.
 */
export function useStreamConsumer(): StreamConsumerState {
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);

  const resetError = useCallback(() => setError(null), []);
  const resetSession = useCallback(() => {
    setError(null);
    setStream(EMPTY_STREAM);
  }, []);

  const runStream = useCallback(
    async (
      messages: ChatMessage[],
      config: ProviderConfig,
      model: string,
      signal: AbortSignal,
      registry: PluginRegistry,
      onMessages: (messages: ChatMessage[]) => void,
    ): Promise<ChatMessage[] | null> => {
      // Clear partial buffers but preserve cumulative `totalTokens` across sends.
      setStream((s) => ({ ...s, text: '', reasoning: '' }));
      setError(null);
      setStreaming(true);
      try {
        return await consumeAgent(runAgent(messages, config, model, signal, registry), setStream, onMessages);
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
        return null;
      } finally {
        setStreaming(false);
        // Preserve partial output on abort so the user can see what arrived;
        // clear it on clean completion so the persisted assistant message
        // doesn't render twice.
        if (!signal.aborted) {
          setStream((s) => ({ ...s, text: '', reasoning: '' }));
        }
      }
    },
    [],
  );

  return { streaming, error, stream, runStream, resetError, resetSession };
}
