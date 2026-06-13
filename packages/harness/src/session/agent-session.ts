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

  const msgText = (m: Message): string =>
    m.content
      .map((p) =>
        p.type === 'text'
          ? p.text
          : p.type === 'tool_call'
          ? `[call ${p.name} ${JSON.stringify(p.input)}]`
          : p.type === 'tool_result'
          ? p.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
          : ''
      )
      .join(' ')
      .trim();

  /** Ask the model to summarize a slice of the conversation (for compaction). */
  const summarize = async (msgs: Message[]): Promise<string> => {
    const transcript = msgs.map((m) => `${m.role}: ${msgText(m)}`).filter(Boolean).join('\n');
    if (!transcript) return '';
    let out = '';
    try {
      for await (
        const ev of provider.stream({
          model: config.model,
          tools: [],
          messages: [
            {
              role: 'system',
              content: [{
                type: 'text',
                text:
                  'Summarize the conversation below for continuity. Preserve decisions, facts, file paths, code changes, and open tasks. Be concise. Output only the summary.',
              }],
            },
            { role: 'user', content: [{ type: 'text', text: transcript }] },
          ],
        })
      ) {
        if (ev.type === 'text') out += ev.text;
      }
    } catch {
      return '';
    }
    return out.trim();
  };

  /** Replace older messages with a summary, keeping the system message + the last N. */
  const compact = async (opts?: { keepLastTurns?: number }): Promise<void> => {
    const keep = Math.max(1, opts?.keepLastTurns ?? 6);
    const sysCount = messages[0]?.role === 'system' ? 1 : 0;
    if (messages.length <= sysCount + keep + 1) return;
    const middle = messages.slice(sysCount, messages.length - keep);
    if (middle.length === 0) return;
    const summary = await summarize(middle);
    if (!summary) return;
    const summaryMsg: Message = { role: 'user', content: [{ type: 'text', text: `<summary>\n${summary}\n</summary>` }] };
    messages.splice(sysCount, middle.length, summaryMsg);
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

    // After a successful turn, let hooks compact/persist. Failures here never break the turn.
    if (terminal.type === 'turn_end') {
      await Promise.resolve(
        hooks.afterTurn?.({
          messages,
          countTokens: (t) => config.provider.countTokens?.(t, config.model) ?? Promise.resolve(undefined),
          contextWindow: () => config.provider.contextWindow?.(config.model) ?? Promise.resolve(undefined),
          compact,
        }),
      ).catch(() => {});
    }
  };

  return {
    id,
    model: config.model,
    tools,
    get messages() {
      return messages;
    },
    assembleRequest,
    countTokens: (text: string) => config.provider.countTokens?.(text, config.model) ?? Promise.resolve(undefined),
    contextWindow: () => config.provider.contextWindow?.(config.model) ?? Promise.resolve(undefined),
    compact,
    send,
    abort: () => controller?.abort(),
    subscribe: emitter.subscribe,
  };
};
