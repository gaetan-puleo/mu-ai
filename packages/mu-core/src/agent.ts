import {
  runAfterAgentRunHooks,
  runAfterLlmHooks,
  runAfterToolExecHook,
  runBeforeLlmHooks,
  runBeforeToolExecHook,
} from './hooks';
import type { AgentEvent, PluginTool, ToolResult, TurnResult } from './plugin';
import type { PluginRegistry } from './registry';
import type { ChatMessage, ProviderConfig, StreamChunk, StreamOptions, ToolCall } from './types/llm';

const DEFAULT_PROVIDER_ID = 'openai';

/**
 * Stream a chat completion through the host's provider registry. Resolved
 * by `config.providerId` (default `'openai'`). When no provider matches, we
 * throw — `mu-core` is provider-agnostic, the host is responsible for
 * registering at least one (e.g. via `mu-openai-provider`).
 */
function streamChatViaRegistry(
  registry: PluginRegistry,
  messages: ChatMessage[],
  config: ProviderConfig,
  model: string,
  options: StreamOptions,
): AsyncIterable<StreamChunk> {
  const id = config.providerId ?? DEFAULT_PROVIDER_ID;
  const providers = registry.getProviders();
  const provider = providers?.get(id);
  if (!provider) {
    throw new Error(
      `No provider registered for id "${id}". Register one (e.g. via mu-openai-provider) before calling runAgent.`,
    );
  }
  return provider.streamChat(messages, config, model, options);
}

async function executeTool(call: ToolCall, tools: PluginTool[], signal?: AbortSignal): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return { tool_call_id: call.id, name: call.function.name, content: 'Error: Invalid JSON arguments', error: true };
  }

  const tool = tools.find((t) => t.definition.function.name === call.function.name);
  if (!tool) {
    return {
      tool_call_id: call.id,
      name: call.function.name,
      content: `Error: Unknown tool: ${call.function.name}`,
      error: true,
    };
  }

  try {
    const result = await tool.execute(args, signal);
    // Tools may return either a plain string (error inferred from "Error:"
    // prefix — legacy/convenience form) or a typed `{ content, error }`
    // object that makes the error flag explicit. Both forms are accepted to
    // avoid breaking existing plugin authors.
    if (typeof result === 'string') {
      return { tool_call_id: call.id, name: call.function.name, content: result, error: result.startsWith('Error:') };
    }
    return {
      tool_call_id: call.id,
      name: call.function.name,
      content: result.content,
      error: result.error ?? false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { tool_call_id: call.id, name: call.function.name, content: `Error: ${msg}`, error: true };
  }
}

async function* streamTurn(
  messages: ChatMessage[],
  config: ProviderConfig,
  model: string,
  signal: AbortSignal,
  registry: PluginRegistry,
  toolDefs: PluginTool[],
): AsyncGenerator<AgentEvent, TurnResult> {
  let content = '';
  let reasoning = '';
  let usage = 0;
  let cachedPromptTokens = 0;
  const toolCalls: ToolCall[] = [];

  const hooks = registry.getHooks();
  const hookedMessages = await runBeforeLlmHooks(hooks, messages, config);
  const toolDefinitions = toolDefs.map((t) => t.definition);

  for await (const chunk of streamChatViaRegistry(registry, hookedMessages, config, model, {
    signal,
    tools: toolDefinitions,
    onUsage: (u) => {
      usage = u.totalTokens;
      cachedPromptTokens = u.cachedPromptTokens ?? 0;
    },
  })) {
    if (signal.aborted) {
      break;
    }
    if (chunk.type === 'reasoning') {
      reasoning += chunk.text;
      yield { type: 'reasoning', text: reasoning };
    } else if (chunk.type === 'content') {
      content += chunk.text;
      yield { type: 'content', text: content };
    } else if (chunk.type === 'tool_call') {
      toolCalls.push({ id: chunk.toolCall.id, function: chunk.toolCall.function });
    }
  }

  const result: TurnResult = { content, reasoning, toolCalls, usage, cachedPromptTokens };
  return await runAfterLlmHooks(hooks, result);
}

async function executeOneToolCall(
  tc: ToolCall,
  tools: PluginTool[],
  signal: AbortSignal,
  registry: PluginRegistry,
): Promise<ChatMessage> {
  const hooks = registry.getHooks();
  const hookOutcome = await runBeforeToolExecHook(hooks, tc);

  if ('blocked' in hookOutcome) {
    const content = await runAfterToolExecHook(hooks, tc, hookOutcome.content);
    return {
      role: 'tool',
      content,
      toolCallId: tc.id,
      toolResult: { name: tc.function.name, content, error: hookOutcome.error ?? true },
      toolCallArgs: { [tc.function.name]: tc.function.arguments },
    };
  }

  const result = await executeTool(hookOutcome, tools, signal);
  const content = await runAfterToolExecHook(hooks, hookOutcome, result.content);
  return {
    role: 'tool',
    content,
    toolCallId: result.tool_call_id,
    toolResult: { name: result.name, content, error: result.error },
    toolCallArgs: { [result.name]: tc.function.arguments },
  };
}

async function* executeToolCalls(
  calls: ToolCall[],
  start: ChatMessage[],
  signal: AbortSignal,
  registry: PluginRegistry,
  tools: PluginTool[],
): AsyncGenerator<AgentEvent, ChatMessage[]> {
  let current = start;

  for (const tc of calls) {
    if (signal.aborted) break;
    const toolMessage = await executeOneToolCall(tc, tools, signal, registry);
    if (signal.aborted) break;
    current = [...current, toolMessage];
    yield { type: 'messages', messages: current };
  }
  return current;
}

async function buildMergedConfig(config: ProviderConfig, registry: PluginRegistry): Promise<ProviderConfig> {
  const pluginPrompts = await registry.getSystemPrompts();
  const merged = [config.systemPrompt, ...pluginPrompts].filter(Boolean).join('\n\n');
  const transformed = await registry.applySystemPromptTransforms(merged);
  if (!transformed) return config;
  return { ...config, systemPrompt: transformed };
}

export async function* runAgent(
  initialMessages: ChatMessage[],
  config: ProviderConfig,
  model: string,
  signal: AbortSignal,
  registry: PluginRegistry,
): AsyncGenerator<AgentEvent> {
  const mergedConfig = await buildMergedConfig(config, registry);
  const hooks = registry.getHooks();

  // Wrap the body in try/finally so `afterAgentRun` fires exactly once per
  // `runAgent` call, regardless of how it terminates: normal completion (LLM
  // produced a final response), abort via `signal.aborted`, or generator
  // cancellation by the consumer (Ink unmount, manual `.return()`).
  try {
    const customLoop = registry.getAgentLoop();
    if (customLoop) {
      const filtered = await registry.getFilteredTools();
      yield* customLoop.run(initialMessages, mergedConfig, model, signal, filtered, hooks);
      return;
    }

    let current = initialMessages;

    while (!signal.aborted) {
      // Re-evaluate every turn so per-turn agent switches are honoured.
      const tools = await registry.getFilteredTools();
      const { content, reasoning, toolCalls, usage, cachedPromptTokens } = yield* streamTurn(
        current,
        mergedConfig,
        model,
        signal,
        registry,
        tools,
      );

      if (usage > 0) {
        yield { type: 'usage', totalTokens: usage, cachedTokens: cachedPromptTokens };
      }
      if (signal.aborted) {
        break;
      }

      const reasoningField = reasoning || undefined;
      const assistant: ChatMessage = { role: 'assistant', content, reasoning: reasoningField };
      if (toolCalls.length === 0) {
        current = [...current, assistant];
        yield { type: 'messages', messages: current };
        return;
      }

      current = [...current, { ...assistant, toolCalls }];
      yield { type: 'messages', messages: current };
      current = yield* executeToolCalls(toolCalls, current, signal, registry, tools);
      yield { type: 'turn_end' };
    }
  } finally {
    await runAfterAgentRunHooks(hooks, signal.aborted ? 'aborted' : 'complete');
  }
}
