import type { EventBus, Unsubscribe } from './bus';
import type { Plugin } from './plugin';
import type { LLMProvider, LLMProviderResult } from './provider';
import { callTool } from './tools/callTool';
import type { ToolHooks } from './types/Hook';
import type { Message } from './types/Message';
import type { Session } from './types/Session';
import type { LLMResponse, LLMResponseContext, LLMStreamEvent, ToolCall, Tools } from './types/Tool';

export type RuntimeState = 'idle' | 'running' | 'stopped';
export type QueueMode = 'one-at-a-time' | 'all';

export type CoreEvent =
  | { type: 'user_message'; message: Message }
  | { type: 'steer'; message: Message }
  | { type: 'follow_up'; message: Message }
  | { type: 'queued_message'; queue: 'steering' | 'follow_up'; message: Message }
  | { type: 'queue_update'; steering: Message[]; followUp: Message[] }
  | { type: 'assistant_start' }
  | { type: 'assistant_delta'; content: string }
  | { type: 'assistant_message'; message: Message }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'reasoning_message'; message: Message }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; message: Message }
  | { type: 'context_update'; context: LLMResponseContext }
  | { type: 'error'; error: unknown };

export interface Runtime {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  state: () => RuntimeState;
  session: () => Session;
  steer: (message: Message) => void;
  followUp: (message: Message) => void;
  queueState: () => { steering: Message[]; followUp: Message[] };
}

export interface RuntimeConfig {
  tools?: Tools;
  plugins?: Plugin[];
  bus: EventBus<CoreEvent>;
  /**
   * The session this runtime operates on. The runtime mutates
   * `session.messages`, `session.steeringQueue`, and `session.followUpQueue`
   * in place — callers can observe progress by reading the same arrays.
   */
  session: Session;
  systemPrompt?: string | (() => string | undefined | Promise<string | undefined>);
  hooks?: ToolHooks;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  /**
   * Throws when the same `(tool, args)` pair is observed more than this many
   * times within a single turn. Guards against runaway loops. Defaults to 5.
   */
  maxRepeatedToolCalls?: number;
  /**
   * Per-turn filter applied to the merged (base + plugin) tool map. Use this
   * to hide tools entirely from a turn — the LLM won't see the schema and the
   * filtered tools' system prompts won't be injected. Called before each
   * provider call.
   */
  toolFilter?: (tools: Tools) => Tools;
}

function isAsyncIterable(value: LLMProviderResult): value is AsyncIterable<LLMStreamEvent> {
  return !!value && typeof value === 'object' && Symbol.asyncIterator in value;
}

const DEFAULT_MAX_REPEATED_TOOL_CALLS = 5;

function mergePluginTools(baseTools: Tools, plugins: Plugin[]): Tools {
  const tools = { ...baseTools };

  for (const plugin of plugins) {
    for (const [name, tool] of Object.entries(plugin.tools ?? {})) {
      if (tools[name]) {
        throw new Error(`Tool "${name}" from plugin "${plugin.name}" is already registered`);
      }
      tools[name] = tool;
    }
  }

  return tools;
}

function resolveProvider(plugins: Plugin[]): LLMProvider {
  const pluginProviders = plugins.filter((p) => p.provider);
  if (pluginProviders.length === 0) {
    throw new Error('No provider configured: supply a plugin with a provider');
  }
  if (pluginProviders.length > 1) {
    throw new Error(
      `Multiple plugins provide a provider: ${pluginProviders.map((p) => p.name).join(', ')}. ` +
        'Use only one provider plugin.',
    );
  }
  return pluginProviders[0].provider!;
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const { bus, hooks, session } = config;
  const plugins = config.plugins ?? [];
  const provider = resolveProvider(plugins);
  const allTools = mergePluginTools(config.tools ?? {}, plugins);
  const toolFilter = config.toolFilter;
  const getTools = (): Tools => (toolFilter ? toolFilter(allTools) : allTools);
  const maxRepeatedToolCalls = config.maxRepeatedToolCalls ?? DEFAULT_MAX_REPEATED_TOOL_CALLS;

  const messages = session.messages;
  const queue: Message[] = [];
  const steeringQueue = session.steeringQueue;
  const followUpQueue = session.followUpQueue;
  const steeringMode = config.steeringMode ?? 'one-at-a-time';
  const followUpMode = config.followUpMode ?? 'one-at-a-time';

  let currentState: RuntimeState = 'idle';
  let unsubscribe: Unsubscribe | undefined;
  let processing = false;

  async function callOnStart(): Promise<void> {
    for (const plugin of plugins) {
      await plugin.hooks?.onStart?.();
    }
  }

  async function callOnStop(): Promise<void> {
    for (let i = plugins.length - 1; i >= 0; i--) {
      await plugins[i]?.hooks?.onStop?.();
    }
  }

  function callOnError(error: unknown): void {
    for (const plugin of plugins) {
      try {
        plugin.hooks?.onError?.(error);
      } catch {
        // ignore plugin error-hook failures
      }
    }
  }

  async function callLifecycleHook(hook: () => Promise<void>): Promise<void> {
    try {
      await hook();
    } catch (error) {
      bus.publish({ type: 'error', error });
      callOnError(error);
    }
  }

  function drainQueue(source: Message[], mode: QueueMode): Message[] {
    if (mode === 'all') {
      const drained = source.slice();
      source.length = 0;
      return drained;
    }

    const first = source.shift();
    return first ? [first] : [];
  }

  function emitQueueUpdate(): void {
    bus.publish({ type: 'queue_update', steering: [...steeringQueue], followUp: [...followUpQueue] });
  }

  function drainIntoTranscript(source: Message[], mode: QueueMode, queueType: 'steering' | 'follow_up'): boolean {
    const drained = drainQueue(source, mode);
    if (!drained.length) {
      return false;
    }

    emitQueueUpdate();
    for (const message of drained) {
      messages.push(message);
      bus.publish({ type: 'queued_message', queue: queueType, message });
    }
    return true;
  }

  function startTurn(message: Message): void {
    queue.push(message);
    void processQueue();
  }

  function enqueueSide(sideQueue: Message[], message: Message, queueType: 'steering' | 'follow_up'): void {
    sideQueue.push(message);
    emitQueueUpdate();

    if (currentState === 'idle' && !processing) {
      sideQueue.shift();
      emitQueueUpdate();
      bus.publish({ type: 'queued_message', queue: queueType, message });
      startTurn(message);
    }
  }

  async function resolveSystemPrompt(
    prompt: string | (() => string | undefined | Promise<string | undefined>) | undefined,
  ): Promise<string | undefined> {
    const value = typeof prompt === 'function' ? await prompt() : prompt;
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  async function buildProviderMessages(_activeTools: Tools): Promise<Message[]> {
    // Tool-level `systemPrompt` fields are deliberately NOT auto-injected here.
    // The active set of tools is already advertised to the LLM via the JSON
    // schemas passed alongside the messages. Hosts that want a tool-specific
    // preamble should compose it into `config.systemPrompt` themselves.
    const runtimePrompt = await resolveSystemPrompt(config.systemPrompt);
    if (!runtimePrompt) return messages;
    return [{ role: 'system', content: runtimePrompt }, ...messages];
  }

  function finalizeResponse(response: LLMResponse | undefined, toolCalls: ToolCall[] = []): void {
    const reasoning = response?.reasoning?.trim();
    if (reasoning) {
      const message: Message = { role: 'reasoning', content: reasoning };
      messages.push(message);
      bus.publish({ type: 'reasoning_message', message });
    }

    const content = response?.content ?? '';
    if (content || toolCalls.length) {
      const message: Message = toolCalls.length
        ? { role: 'assistant', content, tool_calls: toolCalls }
        : { role: 'assistant', content };
      messages.push(message);
      if (content) {
        bus.publish({ type: 'assistant_message', message });
      }
    }

    if (response?.context) {
      bus.publish({ type: 'context_update', context: response.context });
    }
  }

  async function processStream(stream: AsyncIterable<LLMStreamEvent>): Promise<ToolCall[]> {
    let content = '';
    let reasoning = '';
    let finalized = false;
    const streamedCalls: ToolCall[] = [];
    const seenCallIds = new Set<string>();
    let doneCalls: ToolCall[] | undefined;

    bus.publish({ type: 'assistant_start' });

    for await (const event of stream) {
      if ((currentState as RuntimeState) === 'stopped') {
        break;
      }

      if (event.type === 'delta') {
        content += event.content;
        bus.publish({ type: 'assistant_delta', content: event.content });
      } else if (event.type === 'reasoning_delta') {
        reasoning += event.content;
        bus.publish({ type: 'reasoning_delta', content: event.content });
      } else if (event.type === 'tool_call') {
        streamedCalls.push(event.call);
        seenCallIds.add(event.call.id);
        bus.publish({ type: 'tool_call', call: event.call });
      } else if (event.type === 'done') {
        const responseCalls = event.response?.tool_calls ?? [];
        for (const call of responseCalls) {
          if (!seenCallIds.has(call.id)) {
            seenCallIds.add(call.id);
            bus.publish({ type: 'tool_call', call });
          }
        }
        doneCalls = responseCalls.length ? responseCalls : undefined;
        finalizeResponse({
          reasoning: event.response?.reasoning ?? reasoning,
          content: event.response?.content ?? content,
          context: event.response?.context,
        }, doneCalls ?? streamedCalls);
        finalized = true;
      }
    }

    if (!finalized && (content || streamedCalls.length)) {
      finalizeResponse({ content }, streamedCalls);
    }

    // `done.response.tool_calls` is canonical when present; otherwise the calls
    // emitted as `tool_call` stream events are the authoritative list.
    return doneCalls ?? streamedCalls;
  }

  async function consumeResult(result: LLMProviderResult): Promise<ToolCall[]> {
    const stream = isAsyncIterable(result)
      ? result
      : (async function* (): AsyncIterable<LLMStreamEvent> {
        yield { type: 'done', response: result };
      })();
    return processStream(stream);
  }

  async function executeToolCalls(calls: ToolCall[], activeTools: Tools): Promise<void> {
    const executeSingle = async (call: ToolCall): Promise<Message> => {
      const tool = activeTools[call.tool];
      if (!tool) {
        throw new Error(`Unknown tool: ${call.tool}`);
      }

      const toolResult = await callTool(tool, call.args, hooks);
      return { role: 'tool', content: toolResult, tool_id: call.id };
    };

    const toolMessages = await Promise.all(calls.map(executeSingle));
    for (const message of toolMessages) {
      messages.push(message);
      bus.publish({ type: 'tool_result', message });
    }
  }

  function checkRepeatedToolCalls(repeatedToolCalls: Map<string, number>, calls: ToolCall[]): void {
    for (const call of calls) {
      const key = `${call.tool}:${call.args.slice(0, 500)}`;
      const count = (repeatedToolCalls.get(key) ?? 0) + 1;
      repeatedToolCalls.set(key, count);
      if (count > maxRepeatedToolCalls) {
        throw new Error(`Tool call loop detected: ${call.tool} repeated ${count} times with the same arguments`);
      }
    }
  }

  async function processQueue(): Promise<void> {
    if (processing || currentState === 'stopped') {
      return;
    }

    const next = queue.shift();
    if (!next) {
      currentState = 'idle';
      return;
    }

    processing = true;
    currentState = 'running';
    messages.push(next);
    const repeatedToolCalls = new Map<string, number>();

    try {
      while ((currentState as RuntimeState) !== 'stopped') {
        const activeTools = getTools();
        const providerMessages = await buildProviderMessages(activeTools);
        const result = await provider(providerMessages, activeTools);

        const calls = await consumeResult(result);

        if (calls.length) {
          checkRepeatedToolCalls(repeatedToolCalls, calls);
          await executeToolCalls(calls, activeTools);
          drainIntoTranscript(steeringQueue, steeringMode, 'steering');
          continue;
        }

        if (drainIntoTranscript(steeringQueue, steeringMode, 'steering')) continue;
        if (drainIntoTranscript(followUpQueue, followUpMode, 'follow_up')) continue;
        break;
      }
    } catch (error) {
      bus.publish({ type: 'error', error });
      callOnError(error);
    } finally {
      processing = false;
      void processQueue();
    }
  }

  return {
    async start() {
      if (currentState === 'stopped') {
        throw new Error('Cannot start a stopped runtime. Create a new runtime instead.');
      }
      if (unsubscribe) {
        return;
      }

      currentState = 'idle';
      await callLifecycleHook(callOnStart);

      unsubscribe = bus.subscribe((event) => {
        if (event.type === 'steer') {
          enqueueSide(steeringQueue, event.message, 'steering');
          return;
        }

        if (event.type === 'follow_up') {
          enqueueSide(followUpQueue, event.message, 'follow_up');
          return;
        }

        if (event.type === 'user_message') {
          startTurn(event.message);
        }
      });
    },

    async stop() {
      currentState = 'stopped';
      unsubscribe?.();
      unsubscribe = undefined;
      queue.length = 0;
      steeringQueue.length = 0;
      followUpQueue.length = 0;
      emitQueueUpdate();
      await callLifecycleHook(callOnStop);
    },

    state() {
      return currentState;
    },

    session() {
      return session;
    },

    steer(message) {
      enqueueSide(steeringQueue, message, 'steering');
    },

    followUp(message) {
      enqueueSide(followUpQueue, message, 'follow_up');
    },

    queueState() {
      return { steering: [...steeringQueue], followUp: [...followUpQueue] };
    },
  };
}
