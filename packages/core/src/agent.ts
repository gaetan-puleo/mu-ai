import type { ContentPart, Message, Provider, Tool, Usage } from './types';

type ToolCallPart = Extract<ContentPart, { type: 'tool_call' }>;

export type LoopEvent =
  | ContentPart
  | { type: 'usage'; usage: Usage }
  | { type: 'reasoning'; text: string }
  | { type: 'message'; message: Message }
  | { type: 'done'; messages: Message[] };

const append = (parts: ContentPart[], part: ContentPart): void => {
  const last = parts[parts.length - 1];
  if (part.type === 'text' && last?.type === 'text') {
    last.text += part.text;
  } else if (part.type === 'audio' && last?.type === 'audio' && last.mime === part.mime) {
    const merged = new Uint8Array(last.data.length + part.data.length);
    merged.set(last.data);
    merged.set(part.data, last.data.length);
    last.data = merged;
  } else if (part.type === 'text') {
    parts.push({ type: 'text', text: part.text });
  } else if (part.type === 'audio') {
    parts.push({ type: 'audio', mime: part.mime, data: part.data });
  } else {
    parts.push(part);
  }
};

const execute = async (tools: Map<string, Tool>, call: ToolCallPart, signal?: AbortSignal): Promise<ContentPart[]> => {
  const tool = tools.get(call.name);
  if (!tool) return [{ type: 'text', text: `Unknown tool: ${call.name}` }];
  try {
    return await tool.run(call.input, { signal });
  } catch (err) {
    return [{ type: 'text', text: err instanceof Error ? err.message : String(err) }];
  }
};

export interface RunOptions {
  provider: Provider;
  model: string;
  messages: Message[];
  tools?: Tool[];
  signal?: AbortSignal;
}

export async function* run(opts: RunOptions): AsyncIterable<LoopEvent> {
  const { provider, model, signal } = opts;
  const tools = opts.tools ?? [];
  const registry = new Map(tools.map((t) => [t.name, t]));
  const messages = [...opts.messages];

  while (true) {
    const content: ContentPart[] = [];
    const calls: ToolCallPart[] = [];

    for await (const event of provider.stream({ model, messages, tools, signal })) {
      if (event.type === 'usage' || event.type === 'reasoning') {
        yield event;
        continue;
      }
      yield event;
      append(content, event);
      if (event.type === 'tool_call') calls.push(event);
    }

    const message: Message = { role: 'assistant', content };
    messages.push(message);
    yield { type: 'message', message };

    if (calls.length === 0) break;

    const results: ContentPart[] = await Promise.all(
      calls.map(async (call) => ({
        type: 'tool_result' as const,
        id: call.id,
        content: await execute(registry, call, signal),
      })),
    );
    const toolMessage: Message = { role: 'user', content: results };
    messages.push(toolMessage);
    yield { type: 'message', message: toolMessage };
  }

  yield { type: 'done', messages };
}

export interface AgentConfig {
  provider: Provider;
  model: string;
  tools?: Tool[];
  system?: string;
  signal?: AbortSignal;
}

export type Input = string | ContentPart[] | Message[];

export interface AgentResult {
  message: Message;
  messages: Message[];
}

export interface Agent {
  stream(input: Input): AsyncIterable<LoopEvent>;
  run(input: Input): Promise<AgentResult>;
}

const isMessages = (input: ContentPart[] | Message[]): input is Message[] => input.length > 0 && 'role' in input[0];

const toMessages = (input: Input): Message[] => {
  if (typeof input === 'string') return [{ role: 'user', content: [{ type: 'text', text: input }] }];
  if (isMessages(input)) return input;
  return [{ role: 'user', content: input }];
};

export const createAgent = (config: AgentConfig): Agent => {
  const tools = config.tools ?? [];

  const build = (input: Input): Message[] => {
    const messages = toMessages(input);
    if (!config.system) return messages;
    return [{ role: 'system', content: [{ type: 'text', text: config.system }] }, ...messages];
  };

  const stream = (input: Input): AsyncIterable<LoopEvent> =>
    run({ provider: config.provider, model: config.model, tools, messages: build(input), signal: config.signal });

  const runToEnd = async (input: Input): Promise<AgentResult> => {
    let message: Message = { role: 'assistant', content: [] };
    let messages: Message[] = [];
    for await (const event of stream(input)) {
      if (event.type === 'message' && event.message.role === 'assistant') message = event.message;
      else if (event.type === 'done') messages = event.messages;
    }
    return { message, messages };
  };

  return { stream, run: runToEnd };
};
