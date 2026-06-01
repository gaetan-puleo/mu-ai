import type { AgentSessionHooks } from './types';

export const mergeHooks = (list: (AgentSessionHooks | undefined)[]): AgentSessionHooks => {
  const hooks = list.filter((h): h is AgentSessionHooks => h !== undefined);
  const merged: AgentSessionHooks = {};

  if (hooks.some((h) => h.sessionStart)) {
    merged.sessionStart = async () => {
      for (const h of hooks) await h.sessionStart?.();
    };
  }

  if (hooks.some((h) => h.prepareRequest)) {
    merged.prepareRequest = async (req) => {
      let current = req;
      for (const h of hooks) {
        const next = await h.prepareRequest?.(current);
        if (next) current = { system: next.system ?? current.system, tools: next.tools ?? current.tools };
      }
      return current;
    };
  }

  if (hooks.some((h) => h.beforeToolCall)) {
    merged.beforeToolCall = async (call) => {
      for (const h of hooks) {
        const blocked = await h.beforeToolCall?.(call);
        if (blocked) return blocked;
      }
    };
  }

  if (hooks.some((h) => h.afterToolCall)) {
    merged.afterToolCall = async (call) => {
      let result = call.result;
      for (const h of hooks) {
        const next = await h.afterToolCall?.({ name: call.name, result });
        if (next) result = next;
      }
      return result;
    };
  }

  return merged;
};
