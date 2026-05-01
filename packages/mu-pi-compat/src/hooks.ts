import type { AgentEndReason, LifecycleHooks } from 'mu-agents';
import type { ChatMessage, ToolCall } from 'mu-provider';
import type { PiShim } from './shim';

// Sentinel value in tool arguments to signal a blocked tool call
const BLOCKED_MARKER = '__pi_compat_blocked__';

interface HooksState {
  turnIndex: number;
  isFirstTurnOfAgent: boolean;
}

/**
 * Fire an event across all loaded extensions.
 */
async function fireEvent(extensions: PiShim[], event: string, data: unknown): Promise<unknown> {
  let result: unknown;
  for (const ext of extensions) {
    const r = await ext.fireEvent(event as never, data);
    if (r !== undefined && result === undefined) {
      result = r;
    }
  }
  return result;
}

/**
 * Fire tool_call event with blocking support.
 */
async function fireToolCallEvent(
  extensions: PiShim[],
  toolCall: ToolCall,
): Promise<{ block: boolean; reason?: string } | null> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }

  const event = {
    toolName: toolCall.function.name,
    toolCallId: toolCall.id,
    input: args,
  };

  for (const ext of extensions) {
    const r = await ext.fireEvent('tool_call', event);
    if (r && typeof r === 'object' && 'block' in r && (r as { block: boolean }).block) {
      return r as { block: boolean; reason?: string };
    }
  }

  return null;
}

/**
 * Fire tool_result event with result modification support.
 */
async function fireToolResultEvent(extensions: PiShim[], toolCall: ToolCall, result: string): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    args = {};
  }

  const event = {
    toolName: toolCall.function.name,
    toolCallId: toolCall.id,
    input: args,
    content: result,
    details: {},
    isError: result.startsWith('Error:'),
  };

  for (const ext of extensions) {
    const r = await ext.fireEvent('tool_result', event);
    if (r && typeof r === 'object' && 'content' in r) {
      const content = (r as { content: unknown }).content;
      if (typeof content === 'string') {
        event.content = content;
      } else if (Array.isArray(content)) {
        event.content = content
          .map((c: unknown) => (typeof c === 'object' && c !== null && 'text' in c ? (c as { text: string }).text : ''))
          .join('\n');
      }
    }
  }

  return event.content;
}

function parseArgs(toolCall: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return {};
  }
}

function isBlocked(toolCall: ToolCall): boolean {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    return !!args[BLOCKED_MARKER];
  } catch {
    return false;
  }
}

function makeBlockedToolCall(toolCall: ToolCall, reason: string): ToolCall {
  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: JSON.stringify({
        [BLOCKED_MARKER]: true,
        reason,
      }),
    },
  };
}

async function handleBeforeLlm(
  messages: ChatMessage[],
  providerConfig: { systemPrompt?: string },
  extensions: PiShim[],
  state: HooksState,
): Promise<ChatMessage[]> {
  if (state.isFirstTurnOfAgent) {
    const userMsg = [...messages].reverse().find((m: ChatMessage) => m.role === 'user');
    await fireEvent(extensions, 'agent_start', {});
    await fireEvent(extensions, 'before_agent_start', {
      prompt: userMsg?.content ?? '',
      systemPrompt: providerConfig.systemPrompt ?? '',
    });
    state.isFirstTurnOfAgent = false;
  }

  await fireEvent(extensions, 'turn_start', { turnIndex: state.turnIndex, timestamp: Date.now() });

  const contextEvent = { messages: [...messages] };
  const contextResult = await fireEvent(extensions, 'context', contextEvent);
  let current = messages;
  if (contextResult && typeof contextResult === 'object' && 'messages' in contextResult) {
    current = (contextResult as { messages: ChatMessage[] }).messages;
  }

  for (const ext of extensions) {
    const injected = ext.drainInjectedMessages();
    for (const msg of injected) {
      if (msg && typeof msg === 'object' && 'role' in msg && 'content' in msg) {
        current = [...current, msg as ChatMessage];
      }
    }
  }

  return current;
}

async function handleBeforeTool(toolCall: ToolCall, extensions: PiShim[]): Promise<ToolCall> {
  if (isBlocked(toolCall)) return toolCall;

  const args = parseArgs(toolCall);
  await fireEvent(extensions, 'tool_execution_start', {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    args,
  });

  const blockResult = await fireToolCallEvent(extensions, toolCall);
  if (blockResult?.block) {
    return makeBlockedToolCall(toolCall, blockResult.reason ?? 'Blocked by extension');
  }

  return toolCall;
}

async function handleAfterTool(toolCall: ToolCall, result: string, extensions: PiShim[]): Promise<string> {
  if (isBlocked(toolCall)) {
    const args = parseArgs(toolCall);
    return `Blocked: ${args.reason ?? 'Blocked by extension'}`;
  }

  const modified = await fireToolResultEvent(extensions, toolCall, result);

  await fireEvent(extensions, 'tool_execution_end', {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    result: modified,
    isError: modified.startsWith('Error:'),
  });

  return modified;
}

async function handleAfterAgentRun(reason: AgentEndReason, extensions: PiShim[], state: HooksState): Promise<void> {
  // Only fire `agent_end` if an agent run was actually in progress — guards
  // against double-fires (`afterLlmCall` already fired it on a clean
  // no-tool-call exit, so this hook would otherwise fire a second time).
  if (!state.isFirstTurnOfAgent) {
    await fireEvent(extensions, 'agent_end', { messages: [], reason });
    state.isFirstTurnOfAgent = true;
    state.turnIndex = 0;
  }
}

/**
 * Create lifecycle hooks that route mu hook calls to Pi event handlers.
 */
export function createCompatHooks(getExtensions: () => PiShim[], state: HooksState): LifecycleHooks {
  return {
    async beforeLlmCall(messages, providerConfig) {
      return handleBeforeLlm(messages, providerConfig, getExtensions(), state);
    },

    async afterLlmCall(result) {
      const extensions = getExtensions();
      await fireEvent(extensions, 'turn_end', {
        turnIndex: state.turnIndex,
        message: { content: result.content, reasoning: result.reasoning },
        toolResults: [],
      });
      state.turnIndex++;

      if (result.toolCalls.length === 0) {
        await fireEvent(extensions, 'agent_end', { messages: [], reason: 'complete' });
        state.isFirstTurnOfAgent = true;
        state.turnIndex = 0;
      }

      return result;
    },

    async beforeToolExec(toolCall) {
      return handleBeforeTool(toolCall, getExtensions());
    },

    async afterToolExec(toolCall, result) {
      return handleAfterTool(toolCall, result, getExtensions());
    },

    async afterAgentRun(reason) {
      // Belt-and-suspenders: if the agent ended with pending tool calls or via
      // abort, `afterLlmCall`'s clean-exit branch never fired `agent_end`.
      // `handleAfterAgentRun` no-ops when state already reset to keep this
      // exactly-once.
      await handleAfterAgentRun(reason, getExtensions(), state);
    },
  };
}
