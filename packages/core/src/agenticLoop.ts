import { randomUUID } from 'node:crypto';

import type { Message } from './types/Message';
import type { Tool, ToolCall, Response, Action } from './types/Tool';
import type { ToolHooks } from './types/Hook';
import { callTool } from './tools/callTool';

type Agent = (messages: Message[]) => Action;

type Tools = Record<string, Tool>;

export async function* run(agent: Agent, tools: Tools, hooks?: ToolHooks): AsyncGenerator<Message> {
  const messages: Message[] = [];

  while (true) {
    const action = agent(messages);

    if (action.type === 'response') {
      const msg: Message = { role: 'assistant', content: action.content };
      yield msg;
      return;
    }

    if (action.type === 'tool_call') {
      const toolCall: ToolCall = { ...action, id: randomUUID() };
      const msg: Message = { role: 'assistant', content: JSON.stringify(toolCall) };
      yield msg;
      const tool = tools[toolCall.tool];
      if (!tool) {
        throw new Error(`Unknown tool: ${toolCall.tool}`);
      }
      const result = await callTool(tool, toolCall.args, hooks);
      const toolMsg: Message = { role: 'tool', content: result, tool_id: toolCall.id };
      yield toolMsg;
      messages.push(toolMsg);
    }
  }
}

export type { Message, Agent, Tools };
