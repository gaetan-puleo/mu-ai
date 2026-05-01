import type { ChatMessage, ProviderConfig, ToolCall } from 'mu-provider';
import { streamChat } from 'mu-provider';
import {
  runAfterAgentRunHooks,
  runAfterLlmHooks,
  runAfterToolExecHook,
  runBeforeLlmHooks,
  runBeforeToolExecHook,
} from './hooks';
import type { AgentEvent, PluginTool, ToolResult, TurnResult } from './plugin';
import type { PluginRegistry } from './registry';

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
    const content = await tool.execute(args, signal);
    const error = content.startsWith('Error:');
    return { tool_call_id: call.id, name: call.function.name, content, error };
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
): AsyncGenerator<AgentEvent, TurnResult> {
  let content = '';
  let reasoning = '';
  let usage = 0;
  const toolCalls: ToolCall[] = [];

  const hooks = registry.getHooks();
  const hookedMessages = await runBeforeLlmHooks(hooks, messages, config);
  const toolDefinitions = registry.getToolDefinitions();

  for await (const chunk of streamChat(hookedMessages, config, model, {
    signal,
    tools: toolDefinitions,
    onUsage: (u) => {
      usage = u.totalTokens;
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

  const result: TurnResult = { content, reasoning, toolCalls, usage };
  return await runAfterLlmHooks(hooks, result);
}

async function* executeToolCalls(
  calls: ToolCall[],
  start: ChatMessage[],
  signal: AbortSignal,
  registry: PluginRegistry,
): AsyncGenerator<AgentEvent, ChatMessage[]> {
  let current = start;
  const tools = registry.getTools();
  const hooks = registry.getHooks();

  for (const tc of calls) {
    if (signal.aborted) break;

    const hookedCall = await runBeforeToolExecHook(hooks, tc);
    const result = await executeTool(hookedCall, tools, signal);

    if (signal.aborted) break;

    result.content = await runAfterToolExecHook(hooks, hookedCall, result.content);

    const toolMessage: ChatMessage = {
      role: 'tool',
      content: result.content,
      toolCallId: result.tool_call_id,
      toolResult: { name: result.name, content: result.content, error: result.error },
      toolCallArgs: { [result.name]: tc.function.arguments },
    };

    current = [...current, toolMessage];
    yield { type: 'messages', messages: current };
  }
  return current;
}

export async function* runAgent(
  initialMessages: ChatMessage[],
  config: ProviderConfig,
  model: string,
  signal: AbortSignal,
  registry: PluginRegistry,
): AsyncGenerator<AgentEvent> {
  // Merge plugin system prompts into config
  const pluginPrompts = await registry.getSystemPrompts();
  const mergedConfig: ProviderConfig =
    pluginPrompts.length > 0
      ? { ...config, systemPrompt: [config.systemPrompt, ...pluginPrompts].filter(Boolean).join('\n\n') }
      : config;

  const hooks = registry.getHooks();
  // Wrap the body in try/finally so `afterAgentRun` fires exactly once per
  // `runAgent` call, regardless of how it terminates: normal completion (LLM
  // produced a final response), abort via `signal.aborted`, or generator
  // cancellation by the consumer (Ink unmount, manual `.return()`).
  try {
    // Check if a plugin provides a custom agent loop
    const customLoop = registry.getAgentLoop();
    if (customLoop) {
      yield* customLoop.run(initialMessages, mergedConfig, model, signal, registry.getTools(), hooks);
      return;
    }

    let current = initialMessages;

    while (!signal.aborted) {
      const { content, reasoning, toolCalls, usage } = yield* streamTurn(
        current,
        mergedConfig,
        model,
        signal,
        registry,
      );

      if (usage > 0) {
        yield { type: 'usage', totalTokens: usage };
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
      current = yield* executeToolCalls(toolCalls, current, signal, registry);
      yield { type: 'turn_end' };
    }
  } finally {
    await runAfterAgentRunHooks(hooks, signal.aborted ? 'aborted' : 'complete');
  }
}
