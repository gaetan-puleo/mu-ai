/**
 * Session — owns the message history for a conversation context, runs the
 * agent loop on submit, and emits events to subscribers (TUI, persistence,
 * HTTP relay, …).
 *
 * Multi-session: channels emit a `sessionId`; SessionManager lazily
 * instantiates a Session per key. mu-coding uses 'tui'; Arya uses
 * `telegram:${chatId}`, etc.
 */

import { runAgent } from './agent';
import type { ChannelResponder, InboundMessage } from './channel';
import type { PluginRegistry } from './registry';
import type { ChatMessage, ProviderConfig } from './types/llm';

export type SessionEvent =
  | { type: 'messages_changed'; messages: ChatMessage[] }
  | { type: 'stream_partial'; text: string; reasoning?: string }
  | { type: 'stream_started' }
  | { type: 'stream_ended' }
  | { type: 'usage'; totalTokens: number; cachedTokens: number }
  | { type: 'error'; message: string };

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
  /**
   * Synthetic messages already in state that should NOT be re-appended (the
   * caller updated React state imperatively). When omitted, Session works
   * off its own tracked transcript.
   */
  baseMessages?: ChatMessage[];
}

export interface Session {
  readonly id: string;
  getMessages: () => ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  submit: (input: InboundMessage, responder: ChannelResponder) => Promise<void>;
  /**
   * Lower-level entry point used by hosts that pre-process the user input
   * (transformUserInput hooks, attachments). Appends the message, drains
   * the next-turn queue, runs the agent loop, and emits events.
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
  }

  queueForNextTurn(msg: ChatMessage): void {
    this.queue.push(msg);
  }

  abort(): void {
    if (this.abortCtl) this.abortCtl.abort();
  }

  async submit(input: InboundMessage, _responder: ChannelResponder): Promise<void> {
    if (input.text === undefined) return;
    const userMsg: ChatMessage = { role: 'user', content: input.text };
    await this.runTurn({ userMessage: userMsg });
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
        this.emit({ type: 'usage', totalTokens: e.totalTokens, cachedTokens: e.cachedTokens ?? 0 });
      } else if (e.type === 'turn_end') {
        // Clear the locally-tracked partial buffers AND notify subscribers,
        // otherwise the host's `stream` state still holds the previous step's
        // reasoning/content between agent loop iterations — visible as a
        // stale "thinking…" block lingering after a tool call until the next
        // step's first `content`/`reasoning` chunk overwrites it.
        partialText = '';
        partialReasoning = '';
        this.emit({ type: 'stream_partial', text: '', reasoning: '' });
      }
    }
    return final;
  }

  async runTurn(options: RunTurnOptions): Promise<ChatMessage[] | null> {
    // Re-entrance guard. Concurrent `runTurn` calls would overwrite
    // `abortCtl` (orphaning the previous abort controller) and append two
    // user messages onto the same transcript, racing the agent loop. Hosts
    // are responsible for not interleaving turns; the SDK enforces it.
    if (this.abortCtl !== null) {
      throw new Error(`Session "${this.id}" already running a turn. Call abort() first or wait for completion.`);
    }
    if (options.baseMessages) this.messages = options.baseMessages.slice();
    // Skip the push when the caller didn't supply a userMessage — that
    // happens when a `transformUserInput` hook returned `'continue'` and
    // already appended the user's message itself (see `UserInputTransform`).
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
  return {
    getOrCreate(key, init) {
      let s = sessions.get(key);
      if (!s) {
        s = new SessionImpl(key, opts.registry, opts.config, opts.model, init);
        sessions.set(key, s);
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
  };
}
