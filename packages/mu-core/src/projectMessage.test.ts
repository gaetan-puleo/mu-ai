import { describe, expect, it } from 'bun:test';
import { projectMessage } from './projectMessage';
import type { ChatMessage } from './types/llm';

describe('projectMessage', () => {
  it('projects a user message with meta.agent', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'hello',
      meta: { id: 'u1', ts: 100, agent: 'arya' },
    };
    const row = projectMessage(msg);
    expect(row).toEqual({
      id: 'u1',
      role: 'user',
      text: 'hello',
      ts: 100,
      agent: 'arya',
    });
  });

  it('projects an assistant message with reasoning + display badge', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'answer',
      reasoning: 'because',
      meta: { id: 'a1', ts: 200 },
      display: { badge: 'arya', color: '#fff' },
    };
    const row = projectMessage(msg);
    expect(row.reasoning).toBe('because');
    expect(row.badge).toBe('arya');
    expect(row.color).toBe('#fff');
  });

  it('flattens tool message: content empty + structured result', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: '',
      toolCallId: 'call_1',
      toolResult: { name: 'read', content: 'body', error: false },
      meta: { id: 't1', ts: 300 },
    };
    const row = projectMessage(msg);
    expect(row.role).toBe('tool');
    expect(row.text).toBe('');
    expect(row.toolName).toBe('read');
    expect(row.toolResult).toBe('body');
    expect(row.toolError).toBe(false);
  });

  it('pretty-prints toolCallArgs when meta.toolArgs missing', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: '',
      toolCallArgs: { x: '1', y: '2' },
      meta: { id: 't2', ts: 0 },
    };
    const row = projectMessage(msg);
    expect(row.toolArgs).toContain('"x"');
    expect(row.toolArgs).toContain('"y"');
  });

  it('falls back to indexHint when meta.id missing', () => {
    const msg: ChatMessage = { role: 'user', content: 'x' };
    const row = projectMessage(msg, 7);
    expect(row.id).toBe('m-7');
  });

  it('uses toolCallId as id fallback for tool messages', () => {
    const msg: ChatMessage = {
      role: 'tool',
      content: '',
      toolCallId: 'call_42',
    };
    const row = projectMessage(msg);
    expect(row.id).toBe('call_42');
  });

  it('surfaces display.hidden / llmHidden flags', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'header',
      customType: 'mu-agents.subagent',
      display: { hidden: false, llmHidden: true },
    };
    const row = projectMessage(msg);
    expect(row.llmHidden).toBe(true);
    expect(row.hidden).toBeUndefined();
    expect(row.customType).toBe('mu-agents.subagent');
  });

  it('coerces system role to assistant', () => {
    const msg: ChatMessage = { role: 'system', content: 'note' };
    const row = projectMessage(msg);
    expect(row.role).toBe('assistant');
  });
});
