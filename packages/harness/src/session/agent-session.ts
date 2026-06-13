import { type ContentPart, type Message, type Provider, run, type Tool } from 'mu-core';
import { createEmitter } from '../common';
import { type AgentSessionHooks, withHooks } from '../hooks';
import { type Plugin, resolve } from '../plugin';
import type { AgentSession, AgentSessionEvent, AssembledRequest } from './types';

export interface AgentSessionConfig {
  provider: Provider;
  model: string;
  tools?: Tool[];
  hooks?: AgentSessionHooks;
  plugins?: Plugin[];
  system?: string;
  id?: string;
  messages?: Message[];
}

const toMessage = (input: string | ContentPart[]): Message => ({
  role: 'user',
  content: typeof input === 'string' ? [{ type: 'text', text: input }] : input,
});

const systemMessage = (text: string): Message => ({ role: 'system', content: [{ type: 'text', text }] });

const textOf = (message: Message): string =>
  message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

export const createAgentSession = (config: AgentSessionConfig): AgentSession => {
  const { provider } = config;
  const { tools, hooks } = resolve(config);
  const decorated = tools.map((tool) => withHooks(tool, hooks));

  const id = config.id ?? crypto.randomUUID();
  const messages: Message[] = config.messages
    ? [...config.messages]
    : config.system
    ? [{ role: 'system', content: [{ type: 'text', text: config.system }] }]
    : [];

  const emitter = createEmitter<AgentSessionEvent>();

  let started = false;
  let running = false;
  let controller: AbortController | undefined;

  // Assemble the request from the CURRENT in-memory messages — the real system (base +
  // prepareRequest hook injections like the env block + tool prompt blocks), the post-hook
  // tool set, and the live message list. Reflects "what the next turn would send".
  const assembleRequest = async (): Promise<AssembledRequest> => {
    const hasSystem = messages[0]?.role === 'system';
    const system = hasSystem ? textOf(messages[0]) : '';
    const prepared = await hooks.prepareRequest?.({ system, tools: decorated });
    const callTools = prepared?.tools ?? decorated;
    const baseSystem = prepared?.system ?? system;
    const toolBlock = callTools.map((tool) => tool.prompt?.trim()).filter(Boolean).join('\n');
    const effectiveSystem = [baseSystem, toolBlock].filter(Boolean).join('\n\n');
    const body = hasSystem ? messages.slice(1) : messages;
    const withSystem = effectiveSystem ? [systemMessage(effectiveSystem), ...body] : body;
    const callMessages = prepared?.messages?.length ? [...withSystem, ...prepared.messages] : withSystem;
    return { system: effectiveSystem, tools: callTools, messages: callMessages };
  };

  const send = async (input: string | ContentPart[]): Promise<void> => {
    if (running) throw new Error('AgentSession: busy (a turn is already running)');
    running = true;
    const ac = new AbortController();
    controller = ac;
    let terminal: AgentSessionEvent = { type: 'turn_end' };
    try {
      if (!started) {
        started = true;
        await hooks.sessionStart?.();
      }
      const message = toMessage(input);
      messages.push(message);
      emitter.emit({ type: 'turn_start', input: message });

      const request = await assembleRequest();
      const events = run({
        provider,
        model: config.model,
        tools: [...request.tools],
        messages: [...request.messages],
        signal: ac.signal,
      });
      for await (const event of events) {
        if (event.type === 'message') messages.push(event.message);
        emitter.emit(event);
      }
    } catch (error) {
      if (!ac.signal.aborted) terminal = { type: 'error', error };
    } finally {
      running = false;
      controller = undefined;
    }
    emitter.emit(terminal);
  };

  return {
    id,
    tools,
    get messages() {
      return messages;
    },
    assembleRequest,
    countTokens: (text: string) => config.provider.countTokens?.(text, config.model) ?? Promise.resolve(undefined),
    send,
    abort: () => controller?.abort(),
    subscribe: emitter.subscribe,
  };
};
