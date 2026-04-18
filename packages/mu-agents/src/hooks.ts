import type { ChatMessage, ProviderConfig, ToolCall } from 'mu-provider';
import type { LifecycleHooks, TurnResult } from './plugin';

export async function runBeforeLlmHooks(
  hooks: LifecycleHooks[],
  messages: ChatMessage[],
  config: ProviderConfig,
): Promise<ChatMessage[]> {
  let current = messages;
  for (const hook of hooks) {
    if (hook.beforeLlmCall) {
      current = await hook.beforeLlmCall(current, config);
    }
  }
  return current;
}

export async function runAfterLlmHooks(hooks: LifecycleHooks[], result: TurnResult): Promise<TurnResult> {
  let current = result;
  for (const hook of hooks) {
    if (hook.afterLlmCall) {
      current = await hook.afterLlmCall(current);
    }
  }
  return current;
}

export async function runBeforeToolExecHook(hooks: LifecycleHooks[], toolCall: ToolCall): Promise<ToolCall> {
  let current = toolCall;
  for (const hook of hooks) {
    if (hook.beforeToolExec) {
      current = await hook.beforeToolExec(current);
    }
  }
  return current;
}

export async function runAfterToolExecHook(
  hooks: LifecycleHooks[],
  toolCall: ToolCall,
  result: string,
): Promise<string> {
  let current = result;
  for (const hook of hooks) {
    if (hook.afterToolExec) {
      current = await hook.afterToolExec(toolCall, current);
    }
  }
  return current;
}
