import { Buffer } from 'node:buffer';
import { audio, type ContentPart, image, type Message } from 'mu-core';

export type WireRole = 'user' | 'assistant' | 'system' | 'tool';

/** A non-text content part carried over the wire as base64. */
export interface WireAttachment {
  kind: 'image' | 'audio';
  mime: string;
  data: string;
}

export const partsToAttachments = (parts: readonly ContentPart[]): WireAttachment[] =>
  parts.flatMap((part): WireAttachment[] =>
    part.type === 'image'
      ? [{ kind: 'image', mime: part.mime, data: Buffer.from(part.data).toString('base64') }]
      : part.type === 'audio'
      ? [{ kind: 'audio', mime: part.mime, data: Buffer.from(part.data).toString('base64') }]
      : part.type === 'tool_result'
      ? partsToAttachments(part.content)
      : []
  );

export const attachmentsToParts = (attachments: readonly WireAttachment[]): ContentPart[] =>
  attachments.map((a) => {
    const data = new Uint8Array(Buffer.from(a.data, 'base64'));
    return a.kind === 'image' ? image(a.mime, data) : audio(a.mime, data);
  });

export interface WireToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface WireToolResultInfo {
  name: string;
  content: string;
  error?: boolean;
}

export interface WireMessageMeta {
  source?: string;
  visibility?: 'ui' | 'llm' | 'both';
  transient?: boolean;
}

export interface WireMessage {
  id: string;
  ts: number;
  role: WireRole;
  content: string;
  reasoning?: string;
  channelId?: string;
  toolCalls?: WireToolCall[];
  toolCallId?: string;
  toolResult?: WireToolResultInfo;
  attachments?: WireAttachment[];
  meta?: WireMessageMeta;
}

export const textOf = (parts: readonly ContentPart[]): string =>
  parts.map((part) => (part.type === 'text' ? part.text : '')).join('');

export const argsToString = (
  input: unknown,
): string => (typeof input === 'string' ? input : JSON.stringify(input ?? {}));

export const toolResultText = (parts: readonly ContentPart[]): string =>
  parts
    .map((part) => (part.type === 'text' ? part.text : part.type === 'tool_result' ? toolResultText(part.content) : ''))
    .join('');

export function messageToWire(
  message: Message,
  idBase: string,
  ts: number,
  toolNames: Map<string, string>,
): WireMessage[] {
  if (message.role === 'system') {
    return [{ id: `${idBase}:sys`, ts, role: 'system', content: textOf(message.content), meta: { visibility: 'llm' } }];
  }

  if (message.role === 'assistant') {
    const calls = message.content.filter((p): p is Extract<ContentPart, { type: 'tool_call' }> =>
      p.type === 'tool_call'
    );
    for (const call of calls) toolNames.set(call.id, call.name);
    const toolCalls = calls.map((call) => ({
      id: call.id,
      function: { name: call.name, arguments: argsToString(call.input) },
    }));
    const out: WireMessage = { id: `${idBase}:a`, ts, role: 'assistant', content: textOf(message.content) };
    if (toolCalls.length > 0) out.toolCalls = toolCalls;
    return [out];
  }

  const results = message.content.filter((p): p is Extract<ContentPart, { type: 'tool_result' }> =>
    p.type === 'tool_result'
  );
  if (results.length > 0) {
    return results.map((result, index) => {
      const content = toolResultText(result.content);
      const attachments = partsToAttachments(result.content);
      const out: WireMessage = {
        id: `${idBase}:t${index}`,
        ts,
        role: 'tool' as const,
        content,
        toolCallId: result.id,
        toolResult: { name: toolNames.get(result.id) ?? '', content },
      };
      if (attachments.length > 0) out.attachments = attachments;
      return out;
    });
  }
  const userOut: WireMessage = { id: `${idBase}:u`, ts, role: 'user', content: textOf(message.content) };
  const userAttachments = partsToAttachments(message.content);
  if (userAttachments.length > 0) userOut.attachments = userAttachments;
  return [userOut];
}

export function messagesToWire(messages: readonly Message[], baseTs = 0): WireMessage[] {
  const toolNames = new Map<string, string>();
  const out: WireMessage[] = [];
  messages.forEach((message, index) => {
    out.push(...messageToWire(message, `m${index}`, baseTs + index, toolNames));
  });
  return out;
}
