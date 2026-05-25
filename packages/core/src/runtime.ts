import type { EventBus, Unsubscribe } from './bus';
import type { Plugin } from './plugin';
import type { LLMProvider, LLMProviderResult } from './provider';
import { callTool } from './tools/callTool';
import type { ToolHooks } from './types/Hook';
import type { Message } from './types/Message';
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
  steer: (message: Message) => void;
  followUp: (message: Message) => void;
  queueState: () => { steering: Message[]; followUp: Message[] };
}

export interface RuntimeConfig {
  provider?: LLMProvider;
  tools?: Tools;
  plugins?: Plugin[];
  bus: EventBus<CoreEvent>;
  systemPrompt?: string | (() => string | undefined | Promise<string | undefined>);
  hooks?: ToolHooks;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}

function isAsyncIterable(value: LLMProviderResult): value is AsyncIterable<LLMStreamEvent> {
  return !!value && typeof value === 'object' && Symbol.asyncIterator in value;
}

const MAX_REPEATED_TOOL_CALLS = 5;
const MAX_CONSECUTIVE_ERRORS = 3;

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

function resolveProvider(config: RuntimeConfig): LLMProvider {
  if (config.provider) return config.provider;
  const pluginProviders = (config.plugins ?? []).filter((p) => p.provider);
  if (pluginProviders.length === 0) {
    throw new Error('No provider configured: pass a provider in RuntimeConfig or supply a plugin with a provider');
  }
  if (pluginProviders.length > 1) {
    throw new Error(
      `Multiple plugins provide a provider: ${pluginProviders.map((p) => p.name).join(', ')}. ` +
        'Pass an explicit provider in RuntimeConfig or use only one provider plugin.',
    );
  }
  return pluginProviders[0].provider!;
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const { bus, hooks } = config;
  const provider = resolveProvider(config);
  const plugins = config.plugins ?? [];
  const tools = mergePluginTools(config.tools ?? {}, plugins);

  const messages: Message[] = [];
  const queue: Message[] = [];
  const steeringQueue: Message[] = [];
  const followUpQueue: Message[] = [];
  const steeringMode = config.steeringMode ?? 'one-at-a-time';
  const followUpMode = config.followUpMode ?? 'one-at-a-time';

  let currentState: RuntimeState = 'idle';
  let unsubscribe: Unsubscribe | undefined;
  let processing = false;
  let consecutiveErrors = 0;

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

  function enqueueSide(sideQueue: Message[], message: Message): void {
    if (currentState === 'idle' && !processing) {
      startTurn(message);
      return;
    }

    sideQueue.push(message);
    emitQueueUpdate();
  }

  async function resolveSystemPrompt(
    prompt: string | (() => string | undefined | Promise<string | undefined>) | undefined,
  ): Promise<string | undefined> {
    const value = typeof prompt === 'function' ? await prompt() : prompt;
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  async function buildProviderMessages(): Promise<Message[]> {
    const prompts: string[] = [];
    const runtimePrompt = await resolveSystemPrompt(config.systemPrompt);
    if (runtimePrompt) prompts.push(runtimePrompt);

    for (const tool of Object.values(tools)) {
      const prompt = await resolveSystemPrompt(tool.systemPrompt);
      if (prompt) prompts.push(prompt);
    }

    if (prompts.length === 0) return messages;
    return [{ role: 'system', content: prompts.join('\n\n') }, ...messages];
  }

  function finalizeResponse(response: LLMResponse | undefined): void {
    const reasoning = response?.reasoning?.trim();
    if (reasoning) {
      const message: Message = { role: 'reasoning', content: reasoning };
      messages.push(message);
      bus.publish({ type: 'reasoning_message', message });
    }

    if (response?.content) {
      const message: Message = { role: 'assistant', content: response.content };
      messages.push(message);
      bus.publish({ type: 'assistant_message', message });
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
        bus.publish({ type: 'tool_call', call: event.call });
      } else if (event.type === 'done') {
        doneCalls = event.response?.tool_calls;
        finalizeResponse({
          reasoning: event.response?.reasoning ?? reasoning,
          content: event.response?.content ?? content,
          context: event.response?.context,
        });
        finalized = true;
      }
    }

    if (!finalized && content) {
      finalizeResponse({ content });
    }

    // Prefer the authoritative list from `done.response.tool_calls`; otherwise
    // fall back to whatever was emitted via `tool_call` stream events.
    return doneCalls ?? streamedCalls;
  }

  async function consumeResult(result: LLMProviderResult): Promise<ToolCall[]> {
    if (isAsyncIterable(result)) {
      return await processStream(result);
    }

    finalizeResponse(result);
    const calls = result.tool_calls ?? [];
    for (const call of calls) {
      bus.publish({ type: 'tool_call', call });
    }
    return calls;
  }

  async function executeToolCalls(calls: ToolCall[]): Promise<void> {
    const executeSingle = async (call: ToolCall): Promise<Message> => {
      const tool = tools[call.tool];
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

  function appendAssistantToolCalls(calls: ToolCall[]): void {
    const message: Message = { role: 'assistant', content: '', tool_calls: calls };
    messages.push(message);
  }

  function checkRepeatedToolCalls(repeatedToolCalls: Map<string, number>, calls: ToolCall[]): void {
    for (const call of calls) {
      const key = `${call.tool}:${call.args.slice(0, 500)}`;
      const count = (repeatedToolCalls.get(key) ?? 0) + 1;
      repeatedToolCalls.set(key, count);
      if (count > MAX_REPEATED_TOOL_CALLS) {
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
        const providerMessages = await buildProviderMessages();
        const result = await provider(providerMessages, tools);
        consecutiveErrors = 0;

        const calls = await consumeResult(result);

        if (calls.length) {
          checkRepeatedToolCalls(repeatedToolCalls, calls);
          appendAssistantToolCalls(calls);
          await executeToolCalls(calls);
          drainIntoTranscript(steeringQueue, steeringMode, 'steering');
          continue;
        }

        if (drainIntoTranscript(steeringQueue, steeringMode, 'steering')) continue;
        if (drainIntoTranscript(followUpQueue, followUpMode, 'follow_up')) continue;
        break;
      }
    } catch (error) {
      consecutiveErrors++;
      bus.publish({ type: 'error', error });
      callOnError(error);
    } finally {
      processing = false;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        queue.length = 0;
        steeringQueue.length = 0;
        followUpQueue.length = 0;
        emitQueueUpdate();
        currentState = 'idle';
      } else {
        void processQueue();
      }
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
          enqueueSide(steeringQueue, event.message);
          return;
        }

        if (event.type === 'follow_up') {
          enqueueSide(followUpQueue, event.message);
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

    steer(message) {
      enqueueSide(steeringQueue, message);
    },

    followUp(message) {
      enqueueSide(followUpQueue, message);
    },

    queueState() {
      return { steering: [...steeringQueue], followUp: [...followUpQueue] };
    },
  };
}
