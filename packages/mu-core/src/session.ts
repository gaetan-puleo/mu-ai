/**
 * Session — owns the message history for one conversation, runs the agent loop,
 * and emits events to subscribers (TUI, persistence, WS relay, …).
 *
 * Multi-session: hosts create sessions via SessionManager.getOrCreate(key).
 * mu-coding uses 'tui'; arya uses per-client/per-channel ids.
 *
 * Hosts should prefer `runtime.submitText()` over `session.runTurn()` — the
 * runtime wrapper orchestrates hooks, decorations, and message bus draining.
 */

import { runAgent } from './agent';
import type { PluginRegistry } from './registry';
import type { ChatMessage, ProviderConfig } from './types/llm';

export type SessionEvent =
  | { type: 'messages_changed'; messages: ChatMessage[] }
  | { type: 'stream_partial'; text: string; reasoning?: string }
  | { type: 'stream_started' }
  | { type: 'stream_ended' }
  | { type: 'usage'; totalTokens: number; promptTokens: number; cachedTokens: number }
  | { type: 'error'; message: string }
  /**
   * Emitted by `appendSynthetic`. Carries the single message that was
   * just appended so persistence middleware can react without diffing the
   * full snapshot.
   */
  | { type: 'synthetic_appended'; message: ChatMessage };

export interface RunTurnOptions {
  /**
   * Pre-built user message to append before running the agent loop.
   * Optional: when a plugin's `transformUserInput` returns `'continue'`
   * the hook has already appended its own user message via
   * `MessageBus.append`, and the host calls `runTurn` without a
   * `userMessage` to drain the injectNext queue and stream the LLM
   * without pushing a duplicate.
   */
  userMessage?: ChatMessage;
  /** Override config for this single turn (e.g. fresh model id). */
  config?: ProviderConfig;
  /** Override model for this single turn. */
  model?: string;
  /** Override registry for this single turn (rare). */
  registry?: PluginRegistry;
}

export interface Session {
  readonly id: string;
  getMessages: () => ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  /**
   * Low-level turn entry point. Hosts should prefer `runtime.submitText()`
   * which orchestrates hooks, decorations, and message bus draining before
   * calling this.
   */
  runTurn: (options: RunTurnOptions) => Promise<ChatMessage[] | null>;
  abort: () => void;
  appendSynthetic: (msg: ChatMessage) => void;
  queueForNextTurn: (msg: ChatMessage) => void;
  subscribe: (listener: (event: SessionEvent) => void) => () => void;
}

export interface SessionInit {
  initialMessages?: ChatMessage[];
  systemPrompt?: string;
}

export interface SessionManager {
  getOrCreate: (key: string, init?: SessionInit) => Session;
  get: (key: string) => Session | undefined;
  list: () => Session[];
  close: (key: string) => Promise<void>;
  /**
   * Subscribe to "a new Session instance was just created" events. Fires
   * exactly once per session id. Hosts use this to attach per-session
   * middleware (auto-persistence, WS bridging, …) without having to
   * intercept every `getOrCreate` call.
   */
  onSessionCreated: (listener: (session: Session) => void) => () => void;
}

export interface CreateSessionManagerOptions {
  registry: PluginRegistry;
  config: ProviderConfig;
  model: string;
}

class SessionImpl implements Session {
  readonly id: string;
  private messages: ChatMessage[] = [];
  private queue: ChatMessage[] = [];
  private listeners = new Set<(e: SessionEvent) => void>();
  private abortCtl: AbortController | null = null;
  private systemPrompt?: string;

  constructor(
    id: string,
    private registry: PluginRegistry,
    private config: ProviderConfig,
    private model: string,
    init?: SessionInit,
  ) {
    this.id = id;
    this.systemPrompt = init?.systemPrompt;
    if (init?.initialMessages) this.messages = init.initialMessages.slice();
  }

  getMessages(): ChatMessage[] {
    return this.messages.slice();
  }

  setMessages(messages: ChatMessage[]): void {
    this.messages = messages.slice();
    this.emit({ type: 'messages_changed', messages: this.messages.slice() });
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SessionEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // listeners must not break the session
      }
    }
  }

  appendSynthetic(msg: ChatMessage): void {
    this.messages.push(msg);
    this.emit({ type: 'messages_changed', messages: this.messages.slice() });
    this.emit({ type: 'synthetic_appended', message: msg });
  }

  queueForNextTurn(msg: ChatMessage): void {
    this.queue.push(msg);
  }

  abort(): void {
    if (this.abortCtl) this.abortCtl.abort();
  }

  private async consumeAgentEvents(
    cfg: ProviderConfig,
    model: string,
    registry: PluginRegistry,
    signal: AbortSignal,
  ): Promise<ChatMessage[] | null> {
    let final: ChatMessage[] | null = null;
    let partialText = '';
    let partialReasoning = '';
    for await (const e of runAgent(this.messages, cfg, model, signal, registry)) {
      if (e.type === 'content') {
        partialText = e.text;
        this.emit({ type: 'stream_partial', text: partialText, reasoning: partialReasoning });
      } else if (e.type === 'reasoning') {
        partialReasoning = e.text;
        this.emit({ type: 'stream_partial', text: partialText, reasoning: partialReasoning });
      } else if (e.type === 'messages') {
        this.messages = e.messages.slice();
        final = this.messages.slice();
        this.emit({ type: 'messages_changed', messages: this.messages.slice() });
      } else if (e.type === 'usage') {
        this.emit({
          type: 'usage',
          totalTokens: e.totalTokens,
          promptTokens: e.promptTokens,
          cachedTokens: e.cachedTokens ?? 0,
        });
      } else if (e.type === 'turn_end') {
        partialText = '';
        partialReasoning = '';
        this.emit({ type: 'stream_partial', text: '', reasoning: '' });
      }
    }
    return final;
  }

  async runTurn(options: RunTurnOptions): Promise<ChatMessage[] | null> {
    if (this.abortCtl !== null) {
      throw new Error(`Session "${this.id}" already running a turn. Call abort() first or wait for completion.`);
    }
    if (options.userMessage) this.messages.push(options.userMessage);
    if (this.queue.length) {
      this.messages.push(...this.queue);
      this.queue = [];
    }
    this.emit({ type: 'messages_changed', messages: this.messages.slice() });
    this.emit({ type: 'stream_started' });
    this.abortCtl = new AbortController();
    const cfg: ProviderConfig = { ...(options.config ?? this.config) };
    if (this.systemPrompt) cfg.systemPrompt = this.systemPrompt;
    const model = options.model ?? this.model;
    const registry = options.registry ?? this.registry;
    try {
      return await this.consumeAgentEvents(cfg, model, registry, this.abortCtl.signal);
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      this.abortCtl = null;
      this.emit({ type: 'stream_ended' });
    }
  }
}

export function createSessionManager(opts: CreateSessionManagerOptions): SessionManager {
  const sessions = new Map<string, SessionImpl>();
  const createdListeners = new Set<(session: Session) => void>();
  return {
    getOrCreate(key, init) {
      let s = sessions.get(key);
      if (!s) {
        s = new SessionImpl(key, opts.registry, opts.config, opts.model, init);
        sessions.set(key, s);
        for (const fn of createdListeners) {
          try {
            fn(s);
          } catch {
            // Listener errors must not break session construction.
          }
        }
      }
      return s;
    },
    get(key) {
      return sessions.get(key);
    },
    list() {
      return Array.from(sessions.values());
    },
    async close(key) {
      const s = sessions.get(key);
      if (s) {
        s.abort();
        sessions.delete(key);
      }
    },
    onSessionCreated(listener) {
      createdListeners.add(listener);
      // Replay existing sessions so late subscribers don't miss them.
      for (const s of sessions.values()) {
        try {
          listener(s);
        } catch {
          // Ignore listener errors during replay.
        }
      }
      return () => {
        createdListeners.delete(listener);
      };
    },
  };
}
