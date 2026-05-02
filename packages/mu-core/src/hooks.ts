import type { AgentEndReason, BeforeToolExecResult, LifecycleHooks, TurnResult, UserInputTransform } from './plugin';
import type { ChatMessage, ProviderConfig, ToolCall } from './types/llm';

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

/**
 * Run every `beforeToolExec` hook in order. Each hook may either return a
 * (possibly mutated) `ToolCall` to keep the chain going, or a `ToolBlock` to
 * short-circuit execution. Once a hook blocks the call, no further hooks run
 * — there's nothing useful to forward.
 */
export async function runBeforeToolExecHook(
  hooks: LifecycleHooks[],
  toolCall: ToolCall,
): Promise<BeforeToolExecResult> {
  let current: BeforeToolExecResult = toolCall;
  for (const hook of hooks) {
    if (!hook.beforeToolExec) continue;
    if ('blocked' in current) return current;
    current = await hook.beforeToolExec(current);
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

/**
 * Pipe a freshly built `ChatMessage` through every `decorateMessage` hook in
 * order. Each hook may return a (possibly mutated) message; later hooks see
 * the result of the previous one. Used to stamp display hints (agent badge,
 * color) without coupling the host to any specific plugin.
 */
export async function runDecorateMessageHooks(hooks: LifecycleHooks[], msg: ChatMessage): Promise<ChatMessage> {
  let current = msg;
  for (const hook of hooks) {
    if (hook.decorateMessage) {
      current = await hook.decorateMessage(current);
    }
  }
  return current;
}

export async function runAfterAgentRunHooks(hooks: LifecycleHooks[], reason: AgentEndReason): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterAgentRun) {
      await hook.afterAgentRun(reason);
    }
  }
}

/**
 * Compose every `transformUserInput` hook. Earlier hooks see the raw text;
 * each subsequent hook sees the (possibly rewritten) text emitted by the
 * previous one. The first `intercept` or `continue` short-circuits the chain
 * — once a plugin has either suppressed the input or appended the user
 * message itself, downstream hooks can't safely keep transforming absent
 * text, and the host needs to see the terminating signal verbatim so it
 * skips its own user-message push (see `useOnSend`).
 */
export async function runTransformUserInputHooks(hooks: LifecycleHooks[], text: string): Promise<UserInputTransform> {
  let current: UserInputTransform = { kind: 'pass' };
  let working = text;
  for (const hook of hooks) {
    if (!hook.transformUserInput) continue;
    const next = await hook.transformUserInput(working);
    if (next.kind === 'intercept') {
      return next;
    }
    if (next.kind === 'continue') {
      return next;
    }
    if (next.kind === 'transform') {
      working = next.text;
      current = next;
    }
  }
  return current;
}
