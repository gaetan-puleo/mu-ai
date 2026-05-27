import type { EventBus, Unsubscribe } from './bus';
import type { Plugin } from './plugin';
import type { LLMProvider, LLMProviderResult } from './provider';
import { callTool } from './tools/callTool';
import type { ToolHooks } from './types/Hook';
import type { Message } from './types/Message';
import type { Session } from './types/Session';
import type { LLMResponse, LLMResponseContext, LLMStreamEvent, Resolvable, ToolCall, Tools } from './types/Tool';

export type RuntimeState = 'idle' | 'running' | 'stopped';

export type CoreEvent =
  | { type: 'user_message'; message: Message }
  | { type: 'steer'; message: Message }
  | { type: 'follow_up'; message: Message }
  | { type: 'queued_message'; queue: 'steering' | 'follow_up'; message: Message }
  | { type: 'queue_update'; steering: readonly Message[]; followUp: readonly Message[] }
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
  systemPrompt?: Resolvable<string>;
  hooks?: ToolHooks;
  /**
   * Breaks the turn when the same `(tool, args)` pair is observed more than
   * this many times within a single turn. Guards against runaway loops.
   * Defaults to 5.
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

  let currentState: RuntimeState = 'idle';
  let unsubscribe: Unsubscribe | undefined;
  let processing = false;
  let startPromise: Promise<void> | undefined;

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

  function emitQueueUpdate(): void {
    bus.publish({ type: 'queue_update', steering: [...steeringQueue], followUp: [...followUpQueue] });
  }

  function drainIntoTranscript(source: Message[], queueType: 'steering' | 'follow_up'): boolean {
    const message = source.shift();
    if (!message) {
      return false;
    }

    emitQueueUpdate();
    messages.push(message);
    bus.publish({ type: 'queued_message', queue: queueType, message });
    return true;
  }

  function enqueueSide(sideQueue: Message[], message: Message, queueType: 'steering' | 'follow_up'): void {
    const wasEmpty = sideQueue.length === 0;
    sideQueue.push(message);
    emitQueueUpdate();

    if (wasEmpty && currentState === 'idle' && !processing) {
      sideQueue.shift();
      emitQueueUpdate();
      bus.publish({ type: 'queued_message', queue: queueType, message });
      queue.push(message);
      void processQueue();
    }
  }

  async function resolveSystemPrompt(prompt: Resolvable<string> | undefined): Promise<string | undefined> {
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

  async function consumeResult(result: LLMProviderResult): Promise<ToolCall[]> {
    let content = '';
    let reasoning = '';
    let finalized = false;
    let started = false;
    const streamedCalls: ToolCall[] = [];
    const seenCallIds = new Set<string>();
    let doneCalls: ToolCall[] | undefined;

    // Publish `assistant_start` lazily on the first non-finalizing event so an
    // empty stream or stop-before-yield doesn't leave the UI typing forever.
    const ensureStarted = (): void => {
      if (!started) {
        started = true;
        bus.publish({ type: 'assistant_start' });
      }
    };

    const handleDone = (response: LLMResponse | undefined): void => {
      const responseCalls = response?.tool_calls ?? [];
      const hasContent = !!(response?.content ?? content);
      const hasReasoning = !!(response?.reasoning ?? reasoning);
      if (hasContent || hasReasoning || responseCalls.length) {
        ensureStarted();
      }
      for (const call of responseCalls) {
        if (!seenCallIds.has(call.id)) {
          seenCallIds.add(call.id);
          bus.publish({ type: 'tool_call', call });
        }
      }
      doneCalls = responseCalls.length ? responseCalls : undefined;
      finalizeResponse({
        reasoning: response?.reasoning ?? reasoning,
        content: response?.content ?? content,
        context: response?.context,
      }, doneCalls ?? streamedCalls);
      finalized = true;
    };

    if (isAsyncIterable(result)) {
      for await (const event of result) {
        if (currentState === 'stopped') {
          break;
        }

        if (event.type === 'delta') {
          ensureStarted();
          content += event.content;
          bus.publish({ type: 'assistant_delta', content: event.content });
        } else if (event.type === 'reasoning_delta') {
          ensureStarted();
          reasoning += event.content;
          bus.publish({ type: 'reasoning_delta', content: event.content });
        } else if (event.type === 'tool_call') {
          ensureStarted();
          streamedCalls.push(event.call);
          seenCallIds.add(event.call.id);
          bus.publish({ type: 'tool_call', call: event.call });
        } else if (event.type === 'done') {
          handleDone(event.response);
        }
      }
    } else {
      handleDone(result);
    }

    if (!finalized && currentState !== 'stopped' && (content || streamedCalls.length)) {
      finalizeResponse({ content }, streamedCalls);
    }

    // `done.response.tool_calls` is canonical when present; otherwise the calls
    // emitted as `tool_call` stream events are the authoritative list.
    return doneCalls ?? streamedCalls;
  }

  async function executeToolCalls(calls: ToolCall[], activeTools: Tools): Promise<{ failed: boolean }> {
    let failed = false;
    const toolMessages = await Promise.all(calls.map(async (call): Promise<Message> => {
      const tool = activeTools[call.tool];
      if (!tool) {
        failed = true;
        const error = new Error(`Unknown tool: ${call.tool}`);
        bus.publish({ type: 'error', error });
        callOnError(error);
        return { role: 'tool', content: `Error: ${error.message}`, tool_id: call.id };
      }

      const toolResult = await callTool(tool, call.args, hooks);
      return { role: 'tool', content: toolResult, tool_id: call.id };
    }));
    for (const message of toolMessages) {
      messages.push(message);
      bus.publish({ type: 'tool_result', message });
    }
    return { failed };
  }

  function checkRepeatedToolCalls(
    repeatedToolCalls: Map<string, number>,
    calls: ToolCall[],
  ): ToolCall | undefined {
    for (const call of calls) {
      const key = `${call.tool}:${call.args.slice(0, 500)}`;
      const count = (repeatedToolCalls.get(key) ?? 0) + 1;
      repeatedToolCalls.set(key, count);
      if (count > maxRepeatedToolCalls) {
        return call;
      }
    }
    return undefined;
  }

  async function processQueue(): Promise<void> {
    if (processing || currentState === 'stopped') {
      return;
    }

    let next = queue.shift();
    let nextSource: 'steering' | 'follow_up' | undefined;
    if (!next) {
      // Promote a side-queue head as the next turn so messages enqueued during
      // a failed turn don't sit dormant until the next user_message.
      if (steeringQueue.length) {
        next = steeringQueue.shift();
        nextSource = 'steering';
      } else if (followUpQueue.length) {
        next = followUpQueue.shift();
        nextSource = 'follow_up';
      }
    }
    if (!next) {
      currentState = 'idle';
      return;
    }

    processing = true;
    currentState = 'running';
    if (nextSource) {
      emitQueueUpdate();
      bus.publish({ type: 'queued_message', queue: nextSource, message: next });
    }
    messages.push(next);
    const repeatedToolCalls = new Map<string, number>();

    try {
      while ((currentState as RuntimeState) !== 'stopped') {
        const activeTools = getTools();
        const providerMessages = await buildProviderMessages(activeTools);
        const lastBeforeCall = messages[messages.length - 1];
        const result = await provider(providerMessages, activeTools);

        const calls = await consumeResult(result);

        if (calls.length) {
          const repeated = checkRepeatedToolCalls(repeatedToolCalls, calls);
          if (repeated) {
            const error = new Error(
              `Tool call loop detected: ${repeated.tool} repeated more than ${maxRepeatedToolCalls} times with the same arguments`,
            );
            // Pair every assistant tool_call with a tool result so the session
            // remains valid for the next provider call.
            for (const call of calls) {
              const message: Message = {
                role: 'tool',
                content: `Error: ${error.message}`,
                tool_id: call.id,
              };
              messages.push(message);
              bus.publish({ type: 'tool_result', message });
            }
            bus.publish({ type: 'error', error });
            callOnError(error);
            break;
          }
          const { failed } = await executeToolCalls(calls, activeTools);
          if (failed) break;
          drainIntoTranscript(steeringQueue, 'steering');
          continue;
        }

        // Detect a wholly empty response: finalizeResponse pushed nothing, so
        // the transcript head is unchanged. Surface as an error and break to
        // avoid an infinite loop on an unresponsive provider.
        if (messages[messages.length - 1] === lastBeforeCall) {
          const error = new Error('Provider returned empty response');
          bus.publish({ type: 'error', error });
          callOnError(error);
          break;
        }

        if (drainIntoTranscript(steeringQueue, 'steering')) continue;
        if (drainIntoTranscript(followUpQueue, 'follow_up')) continue;
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
      if (startPromise) {
        return startPromise;
      }

      currentState = 'idle';
      startPromise = (async () => {
        try {
          await callLifecycleHook(callOnStart);
          if ((currentState as RuntimeState) === 'stopped') {
            return;
          }
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
              queue.push(event.message);
              void processQueue();
            }
          });
        } finally {
          startPromise = undefined;
        }
      })();
      return startPromise;
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
      enqueueSide(steeringQueue, message, 'steering');
    },

    followUp(message) {
      enqueueSide(followUpQueue, message, 'follow_up');
    },
  };
}
