import { appendFileSync } from 'node:fs';
import type { EventBus, Unsubscribe } from './bus';
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

export type Runtime = {
  start(): void;
  stop(): void;
  state(): RuntimeState;
  steer(message: Message): void;
  followUp(message: Message): void;
  queueState(): { steering: Message[]; followUp: Message[] };
};

export type RuntimeConfig = {
  provider: LLMProvider;
  tools: Tools;
  bus: EventBus<CoreEvent>;
  hooks?: ToolHooks;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
};

function isAsyncIterable(value: LLMProviderResult): value is AsyncIterable<LLMStreamEvent> {
  return !!value && typeof value === 'object' && Symbol.asyncIterator in value;
}

const DEBUG_LOG = process.env.MU_TUI_DEBUG_LOG;
const MAX_REPEATED_TOOL_CALLS = 5;

function debugLog(data: Record<string, unknown>): void {
  if (!DEBUG_LOG) return;
  try {
    appendFileSync(DEBUG_LOG, `${JSON.stringify({ ts: Date.now(), source: 'mu-core', ...data })}\n`);
  } catch {
    /* ignore debug logging errors */
  }
}

function truncateForLog(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const { provider, tools, bus, hooks } = config;

  const messages: Message[] = [];
  const queue: Message[] = [];
  const steeringQueue: Message[] = [];
  const followUpQueue: Message[] = [];
  const steeringMode = config.steeringMode ?? 'one-at-a-time';
  const followUpMode = config.followUpMode ?? 'one-at-a-time';

  let currentState: RuntimeState = 'idle';
  let unsubscribe: Unsubscribe | undefined;
  let processing = false;

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

  function appendUserMessages(nextMessages: Message[], queueType?: 'steering' | 'follow_up'): boolean {
    if (!nextMessages.length) {
      return false;
    }

    for (const message of nextMessages) {
      messages.push(message);
      if (queueType) {
        bus.publish({ type: 'queued_message', queue: queueType, message });
      }
    }
    return true;
  }

  function drainSteeringIntoTranscript(): boolean {
    const drained = drainQueue(steeringQueue, steeringMode);
    if (!drained.length) {
      return false;
    }

    emitQueueUpdate();
    return appendUserMessages(drained, 'steering');
  }

  function drainFollowUpIntoTranscript(): boolean {
    const drained = drainQueue(followUpQueue, followUpMode);
    if (!drained.length) {
      return false;
    }

    emitQueueUpdate();
    return appendUserMessages(drained, 'follow_up');
  }

  function enqueueSteering(message: Message): void {
    if (currentState === 'idle' && !processing) {
      queue.push(message);
      void processQueue();
      return;
    }

    steeringQueue.push(message);
    emitQueueUpdate();
  }

  function enqueueFollowUp(message: Message): void {
    if (currentState === 'idle' && !processing) {
      queue.push(message);
      void processQueue();
      return;
    }

    followUpQueue.push(message);
    emitQueueUpdate();
  }

  function publishContext(response: LLMResponse | undefined): void {
    if (response?.context) {
      bus.publish({ type: 'context_update', context: response.context });
    }
  }

  function publishResponse(response: LLMResponse): boolean {
    publishContext(response);

    const reasoning = response.reasoning?.trim();
    if (reasoning) {
      const message: Message = { role: 'reasoning', content: reasoning };
      messages.push(message);
      bus.publish({ type: 'reasoning_message', message });
    }

    if (response.content) {
      const message: Message = { role: 'assistant', content: response.content };
      messages.push(message);
      bus.publish({ type: 'assistant_message', message });
      return true;
    }

    return false;
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
        debugLog({ stage: 'runtime.stream.tool_call', tool: event.call.tool, id: event.call.id, argsLen: event.call.args.length });
        bus.publish({ type: 'tool_call', call: event.call });
      } else if (event.type === 'done') {
        publishContext(event.response);
        doneCalls = event.response?.tool_calls;
        debugLog({
          stage: 'runtime.stream.done',
          contentLen: (event.response?.content ?? content).length,
          streamedToolCalls: streamedCalls.length,
          doneToolCalls: doneCalls?.length ?? 0,
        });

        const finalReasoning = (event.response?.reasoning ?? reasoning).trim();
        if (finalReasoning) {
          const message: Message = { role: 'reasoning', content: finalReasoning };
          messages.push(message);
          bus.publish({ type: 'reasoning_message', message });
        }

        const finalContent = event.response?.content ?? content;
        if (finalContent) {
          const message: Message = { role: 'assistant', content: finalContent };
          messages.push(message);
          bus.publish({ type: 'assistant_message', message });
        }
        finalized = true;
      }
    }

    if (!finalized && content) {
      const message: Message = { role: 'assistant', content };
      messages.push(message);
      bus.publish({ type: 'assistant_message', message });
    }

    // Prefer the authoritative list from `done.response.tool_calls`; otherwise
    // fall back to whatever was emitted via `tool_call` stream events.
    return doneCalls ?? streamedCalls;
  }

  async function executeToolCalls(calls: ToolCall[]): Promise<void> {
    for (const call of calls) {
      debugLog({ stage: 'runtime.tool.execute.start', tool: call.tool, id: call.id, args: truncateForLog(call.args) });
      const tool = tools[call.tool];
      if (!tool) {
        debugLog({ stage: 'runtime.tool.execute.unknown', tool: call.tool, id: call.id });
        throw new Error(`Unknown tool: ${call.tool}`);
      }

      const toolResult = await callTool(tool, call.args, hooks);
      debugLog({
        stage: 'runtime.tool.execute.done',
        tool: call.tool,
        id: call.id,
        resultLen: toolResult.length,
        isErrorResult: toolResult.startsWith('Error:'),
      });
      const message: Message = {
        role: 'tool',
        content: toolResult,
        tool_id: call.id,
      };

      messages.push(message);
      bus.publish({ type: 'tool_result', message });
    }
  }

  function appendAssistantToolCalls(calls: ToolCall[]): void {
    const message: Message = { role: 'assistant', content: '', tool_calls: calls };
    messages.push(message);
    debugLog({ stage: 'runtime.assistant_tool_calls.append', toolCalls: calls.length, messages: messages.length });
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
    let wasStopped = false;
    currentState = 'running';
    messages.push(next);
    let providerCalls = 0;
    const repeatedToolCalls = new Map<string, number>();

    try {
      while (!wasStopped) {
        if ((currentState as RuntimeState) === 'stopped') {
          wasStopped = true;
          break;
        }

        providerCalls++;
        debugLog({ stage: 'runtime.provider.call.start', providerCalls, messages: messages.length, tools: Object.keys(tools) });
        const result = await provider(messages, tools);

        if (isAsyncIterable(result)) {
          const streamedToolCalls = await processStream(result);
          debugLog({ stage: 'runtime.provider.call.stream.done', providerCalls, toolCalls: streamedToolCalls.length });
          if (!streamedToolCalls.length) {
            if (drainSteeringIntoTranscript()) {
              continue;
            }
            if (drainFollowUpIntoTranscript()) {
              continue;
            }
            break;
          }
          for (const call of streamedToolCalls) {
            const key = `${call.tool}:${call.args}`;
            const count = (repeatedToolCalls.get(key) ?? 0) + 1;
            repeatedToolCalls.set(key, count);
            if (count > 1) {
              debugLog({
                stage: 'runtime.tool.loop.suspected',
                providerCalls,
                tool: call.tool,
                id: call.id,
                repeatCount: count,
                args: truncateForLog(call.args),
              });
            }
            if (count > MAX_REPEATED_TOOL_CALLS) {
              throw new Error(`Tool call loop detected: ${call.tool} repeated ${count} times with the same arguments`);
            }
          }
          appendAssistantToolCalls(streamedToolCalls);
          await executeToolCalls(streamedToolCalls);
          drainSteeringIntoTranscript();
          debugLog({ stage: 'runtime.loop.continue_after_tools', providerCalls, toolCalls: streamedToolCalls.length, messages: messages.length });
          continue;
        }

        debugLog({
          stage: 'runtime.provider.call.nonstream.done',
          providerCalls,
          hasContent: !!result.content,
          toolCalls: result.tool_calls?.length ?? 0,
        });

        if (publishResponse(result)) {
          if (drainSteeringIntoTranscript()) {
            continue;
          }
          if (drainFollowUpIntoTranscript()) {
            continue;
          }
          break;
        }

        if (!result.tool_calls?.length) {
          if (drainSteeringIntoTranscript()) {
            continue;
          }
          if (drainFollowUpIntoTranscript()) {
            continue;
          }
          break;
        }

        for (const call of result.tool_calls) {
          const key = `${call.tool}:${call.args}`;
          const count = (repeatedToolCalls.get(key) ?? 0) + 1;
          repeatedToolCalls.set(key, count);
          if (count > 1) {
            debugLog({
              stage: 'runtime.tool.loop.suspected',
              providerCalls,
              tool: call.tool,
              id: call.id,
              repeatCount: count,
              args: truncateForLog(call.args),
            });
          }
          if (count > MAX_REPEATED_TOOL_CALLS) {
            throw new Error(`Tool call loop detected: ${call.tool} repeated ${count} times with the same arguments`);
          }
          bus.publish({ type: 'tool_call', call });
        }
        appendAssistantToolCalls(result.tool_calls);
        await executeToolCalls(result.tool_calls);
        drainSteeringIntoTranscript();
        debugLog({ stage: 'runtime.loop.continue_after_tools', providerCalls, toolCalls: result.tool_calls.length, messages: messages.length });
      }
    } catch (error) {
      debugLog({
        stage: 'runtime.error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      bus.publish({ type: 'error', error });
    } finally {
      processing = false;
      void processQueue();
    }
  }

  return {
    start() {
      if (unsubscribe || currentState === 'stopped') {
        return;
      }

      currentState = 'idle';

      unsubscribe = bus.subscribe((event) => {
        if (event.type === 'steer') {
          enqueueSteering(event.message);
          return;
        }

        if (event.type === 'follow_up') {
          enqueueFollowUp(event.message);
          return;
        }

        if (event.type === 'user_message') {
          queue.push(event.message);
          void processQueue();
        }
      });
    },

    stop() {
      currentState = 'stopped';
      unsubscribe?.();
      unsubscribe = undefined;
      queue.length = 0;
      steeringQueue.length = 0;
      followUpQueue.length = 0;
      emitQueueUpdate();
    },

    state() {
      return currentState;
    },

    steer(message) {
      enqueueSteering(message);
    },

    followUp(message) {
      enqueueFollowUp(message);
    },

    queueState() {
      return { steering: [...steeringQueue], followUp: [...followUpQueue] };
    },
  };
}
