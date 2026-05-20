import { debugLog } from './debug';
import { nowMs } from './ids';
import { newMessage } from './message';
import type { Mu } from './mu';
import { resolveSystemPrompt } from './mu';
import type {
  Hooks,
  Message,
  ProviderConfig,
  RunInput,
  SessionEvent,
  Tool,
  ToolBlock,
  ToolCall,
  ToolResult,
  TurnEvent,
  TurnReason,
  TurnResult,
  Usage,
} from './types';

export interface DumpPayload {
  model?: string;
  messages: Record<string, unknown>[];
  stream: boolean;
  stream_options: { include_usage: boolean };
  cache_prompt: boolean;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
}

async function compose<T, K extends keyof Hooks>(
  hooks: Hooks[],
  name: K,
  initial: T,
  invoke: (hook: NonNullable<Hooks[K]>, current: T) => Promise<T> | T,
): Promise<T> {
  let current = initial;
  for (const h of hooks) {
    const fn = h[name];
    if (fn) current = await invoke(fn as NonNullable<Hooks[K]>, current);
  }
  return current;
}

async function executeTool(call: ToolCall, tools: Tool[], signal?: AbortSignal): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return { content: 'Error: Invalid JSON arguments', error: true };
  }
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return { content: `Error: Unknown tool: ${call.function.name}`, error: true };
  try {
    return await tool.execute(args, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { content: `Error: ${msg}`, error: true };
  }
}

function resolveToolSystemPrompts(tools: Tool[]): string | undefined {
  const lines: string[] = [];
  for (const t of tools) {
    const prompt = typeof t.systemPrompt === 'function' ? t.systemPrompt() : t.systemPrompt;
    if (prompt) lines.push(`- ${prompt}`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

export class Session {
  readonly id: string;
  readonly createdAt: number;
  readonly source: string | undefined;

  private _messages: Message[] = [];
  private _listeners = new Set<(event: SessionEvent) => void>();
  private _mu: Mu;
  private _abortController: AbortController | null = null;
  private _ended = false;

  constructor(opts: {
    id: string;
    mu: Mu;
    createdAt?: number;
    initialMessages?: Message[];
    source?: string;
  }) {
    this.id = opts.id;
    this.createdAt = opts.createdAt ?? nowMs();
    this.source = opts.source;
    this._mu = opts.mu;
    if (opts.initialMessages) this._messages = [...opts.initialMessages];
  }

  messages(): readonly Message[] {
    return this._messages;
  }

  async append(message: Message): Promise<Message | null> {
    let current: Message | null | undefined = message;
    for (const h of this._mu._hooks) {
      if (!h.onMessageAppend) continue;
      const result = await h.onMessageAppend(current as Message, this);
      if (result === null) return null;
      if (result !== undefined) current = result;
    }
    const final = current as Message;
    this._messages.push(final);
    this.emit({ type: 'message_appended', session: this, message: final });

    if (final.channelId) {
      const target = this._mu._channels.find((c) => c.id === final.channelId);
      if (target?.send) {
        try {
          await target.send(final, this);
        } catch {
          // channel send errors are swallowed
        }
      }
    }
    return final;
  }

  clear(): void {
    this._messages = [];
    this.emit({ type: 'transcript_cleared', session: this });
  }

  on(listener: (event: SessionEvent) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  emit(event: SessionEvent): void {
    for (const fn of this._listeners) {
      try {
        fn(event);
      } catch {
        // listener errors don't break the session
      }
    }
  }

  abort(): void {
    this._abortController?.abort();
  }

  end(): void {
    if (this._ended) return;
    this._ended = true;
    this.abort();
    this.emit({ type: 'session_ended', session: this });
    this._listeners.clear();
  }

  async dumpContext(): Promise<DumpPayload> {
    const mu = this._mu;
    const baseConfig: ProviderConfig = { ...mu._config };
    const baseSystemPrompt = await resolveSystemPrompt(mu._systemPrompts, baseConfig.systemPrompt);
    const hooks = mu._hooks;
    const allTools = mu._tools;
    const tools = await compose(hooks, 'filterTools', allTools, (fn, t) => fn(t, this));

    const toolPromptText = resolveToolSystemPrompts(tools);
    const systemPrompt = [baseSystemPrompt, toolPromptText].filter(Boolean).join('\n\n') || undefined;
    const config: ProviderConfig = { ...baseConfig, systemPrompt };

    const visible = this._messages.filter((m) => m.meta?.visibility !== 'ui');
    const prepared = await compose(hooks, 'beforeLlmCall', visible, (fn, m) => fn(m, this));

    const messages: DumpPayload['messages'] = [];
    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    for (const m of prepared) {
      if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        if (m.toolCalls?.length) {
          messages.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: tc.function,
            })),
          });
        } else {
          messages.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        const content = m.toolResult?.content ?? m.content;
        messages.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content });
      } else if (m.role === 'system') {
        messages.push({ role: 'system', content: m.content });
      }
    }

    const dumpTools: DumpPayload['tools'] =
      tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined;

    return {
      model: config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      cache_prompt: true,
      ...(dumpTools ? { tools: dumpTools } : {}),
    };
  }

  run(input: RunInput = {}): AsyncIterable<TurnEvent> {
    const session = this;
    const mu = this._mu;
    const controller = new AbortController();
    this._abortController = controller;

    async function* gen(): AsyncGenerator<TurnEvent> {
      const signal = controller.signal;
      const baseConfig: ProviderConfig = { ...mu._config, ...(input.config ?? {}) };
      const baseSystemPrompt = await resolveSystemPrompt(mu._systemPrompts, baseConfig.systemPrompt);
      // mu-core has no default provider. Hosts must set `config.providerId`
      // explicitly — see e.g. mu-coding wiring `providerId: 'local'` when it
      // starts the session. Yielding a turn_end error here keeps the
      // failure mode identical to "provider id was set but unmatched",
      // which the TUI already surfaces inline.
      const providerId = baseConfig.providerId;
      if (!providerId) {
        yield {
          type: 'turn_end',
          reason: 'error',
          error: new Error(
            'No providerId set on ProviderConfig. mu-core has no default provider; hosts must select one explicitly.',
          ),
        };
        return;
      }
      const provider = mu._providers.find((p) => p.id === providerId);
      if (!provider) {
        yield {
          type: 'turn_end',
          reason: 'error',
          error: new Error(`No provider registered for id "${providerId}".`),
        };
        return;
      }

      session.emit({ type: 'turn_started', session });
      let reason: TurnReason = 'complete';
      let error: Error | undefined;

      try {
        if (input.userMessage) {
          const m = await session.append(input.userMessage);
          if (m) yield { type: 'message', message: m };
        }

        while (!signal.aborted) {
          const allTools = mu._tools;
          const hooks = mu._hooks;
          const tools = await compose(hooks, 'filterTools', allTools, (fn, t) => fn(t, session));
          const toolPromptText = resolveToolSystemPrompts(tools);
          const systemPrompt = [baseSystemPrompt, toolPromptText].filter(Boolean).join('\n\n') || undefined;
          const config: ProviderConfig = { ...baseConfig, systemPrompt };

          const visible = session._messages.filter((m) => m.meta?.visibility !== 'ui');
          const prepared = await compose(hooks, 'beforeLlmCall', visible, (fn, m) => fn(m, session));

          let content = '';
          let reasoning = '';
          let usage: Usage | undefined;
          const toolCalls: ToolCall[] = [];

          debugLog('core', 'stream.start', { providerId, sessionId: session.id });
          for await (const chunk of provider.streamChat(prepared, config, {
            signal,
            tools,
            onUsage: (u) => {
              usage = u;
            },
          })) {
            if (signal.aborted) break;
            if (chunk.type === 'reasoning') {
              reasoning += chunk.text;
              yield { type: 'reasoning', text: reasoning };
            } else if (chunk.type === 'content') {
              content += chunk.text;
              yield { type: 'content', text: content };
            } else if (chunk.type === 'tool_call') {
              toolCalls.push(chunk.toolCall);
            }
          }

          debugLog('core', 'stream.end', {
            contentLen: content.length,
            reasoningLen: reasoning.length,
            toolCalls: toolCalls.length,
            aborted: signal.aborted,
          });

          if (signal.aborted) {
            // Abort fired mid-stream. Commit whatever was streamed so far as
            // a partial assistant message so the user (and JSONL persist
            // layer) keep the partial reply. Tool calls accumulated before
            // abort are intentionally dropped — we never got a chance to
            // dispatch them and re-running them on resume would be wrong.
            // `afterLlmCall` hooks are skipped: they assume a complete turn.
            if (content || reasoning) {
              const partial = newMessage({
                role: 'assistant',
                content,
                reasoning: reasoning || undefined,
              });
              const appendedPartial = await session.append(partial);
              debugLog('core', 'appended.partial-on-abort', {
                id: partial.id,
                contentLen: appendedPartial ? appendedPartial.content.length : -1,
                reasoningLen: appendedPartial?.reasoning?.length ?? 0,
                dropped: !appendedPartial,
              });
              if (appendedPartial) yield { type: 'message', message: appendedPartial };
            }
            break;
          }

          const initial: TurnResult = { content, reasoning, toolCalls, usage };
          const turn = await compose(hooks, 'afterLlmCall', initial, (fn, r) => fn(r, session));

          debugLog('core', 'post-hooks', {
            contentLen: turn.content.length,
            reasoningLen: turn.reasoning.length,
            toolCalls: turn.toolCalls.length,
          });

          if (turn.usage) yield { type: 'usage', usage: turn.usage };

          const assistant = newMessage({
            role: 'assistant',
            content: turn.content,
            reasoning: turn.reasoning || undefined,
            toolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : undefined,
          });
          const appended = await session.append(assistant);
          debugLog('core', 'appended', {
            id: assistant.id,
            contentLen: appended ? appended.content.length : -1,
            dropped: !appended,
          });
          if (appended) yield { type: 'message', message: appended };

          if (turn.toolCalls.length === 0) return;

          for (const call of turn.toolCalls) {
            if (signal.aborted) break;

            const outcome: ToolCall | ToolBlock = await compose(
              hooks,
              'beforeToolExec',
              call as ToolCall | ToolBlock,
              async (fn, c) => ('blocked' in c ? c : await fn(c, session)),
            );

            let result: ToolResult;
            let actualCall: ToolCall;
            if ('blocked' in outcome) {
              actualCall = call;
              result = { content: outcome.content, error: outcome.error ?? true };
            } else {
              actualCall = outcome;
              result = await executeTool(outcome, tools, signal);
            }

            result = await compose(hooks, 'afterToolExec', result, (fn, r) => fn(actualCall, r, session));

            const toolMsg = newMessage({
              role: 'tool',
              content: '',
              toolCallId: actualCall.id,
              toolResult: {
                name: actualCall.function.name,
                content: result.content,
                error: result.error ?? false,
              },
            });
            const m = await session.append(toolMsg);
            if (m) yield { type: 'message', message: m };
          }
        }

        if (signal.aborted) reason = 'aborted';
      } catch (err) {
        reason = 'error';
        error = err instanceof Error ? err : new Error(String(err));
        debugLog('core', 'turn.exception', {
          message: error.message,
          contentLen: 0, // content var is out of scope here; logged separately above
        });
      } finally {
        for (const h of mu._hooks) {
          if (h.onTurnEnd) {
            try {
              await h.onTurnEnd(reason, session);
            } catch {
              // hook errors don't break finalisation
            }
          }
        }
        session.emit({ type: 'turn_ended', session, reason });
        session._abortController = null;
      }

      yield { type: 'turn_end', reason, error };
    }

    return gen();
  }
}
