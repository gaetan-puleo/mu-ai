import type { Tool } from 'mu-core';
import type { AgentSessionHooks } from './types';

export const withHooks = (tool: Tool, hooks: AgentSessionHooks): Tool => {
  if (!hooks.beforeToolCall && !hooks.afterToolCall) return tool;
  const run: Tool['run'] = async (input, ctx) => {
    const blocked = await hooks.beforeToolCall?.({ name: tool.name, input });
    if (blocked) return blocked;
    const result = await tool.run(input, ctx);
    return (await hooks.afterToolCall?.({ name: tool.name, result })) ?? result;
  };
  return Object.assign(Object.create(tool) as Tool, { run });
};
