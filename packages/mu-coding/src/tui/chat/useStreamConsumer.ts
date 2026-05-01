import { type AgentEvent, type PluginRegistry, runAgent } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { useCallback, useState } from 'react';

export interface StreamState {
  text: string;
  reasoning: string;
  tps: number;
}

const EMPTY_STREAM: StreamState = { text: '', reasoning: '', tps: 0 };
const TPS_WARMUP_SEC = 0.5;

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
}

function applyEvent(prev: StreamState, event: AgentEvent, tps: number): StreamState {
  switch (event.type) {
    case 'content':
      return { ...prev, text: event.text, tps };
    case 'reasoning':
      return { ...prev, reasoning: event.text, tps };
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
      const tps = elapsed > TPS_WARMUP_SEC ? Math.round(tokenCount / elapsed) : 0;
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

/**
 * Owns the in-flight streaming view: which tokens have been received, the
 * tokens-per-second meter, error text, and the streaming flag. Decoupled
 * from message persistence so it can be reused by single-shot agents or
 * test harnesses.
 */
export function useStreamConsumer(): StreamConsumerState {
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);

  const resetError = useCallback(() => setError(null), []);

  const runStream = useCallback(
    async (
      messages: ChatMessage[],
      config: ProviderConfig,
      model: string,
      signal: AbortSignal,
      registry: PluginRegistry,
      onMessages: (messages: ChatMessage[]) => void,
    ): Promise<ChatMessage[] | null> => {
      setStream(EMPTY_STREAM);
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

  return { streaming, error, stream, runStream, resetError };
}
