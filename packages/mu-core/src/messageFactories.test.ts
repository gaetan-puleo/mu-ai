import { describe, expect, it } from 'bun:test';
import { makeAssistantMessage, makeSyntheticMessage, makeToolMessage, makeUserMessage } from './messageFactories';

describe('makeUserMessage', () => {
  it('stamps id + ts and stores content', () => {
    const msg = makeUserMessage('hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    expect(typeof msg.meta?.id).toBe('string');
    expect(typeof msg.meta?.ts).toBe('number');
    expect(msg.meta?.agent).toBeUndefined();
  });

  it('writes opts.agent into meta.agent', () => {
    const msg = makeUserMessage('hi', { agent: 'review' });
    expect(msg.meta?.agent).toBe('review');
  });
});

describe('makeAssistantMessage', () => {
  it('stamps meta.agent when provided', () => {
    const msg = makeAssistantMessage('reply', { agent: 'arya' });
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('reply');
    expect(msg.meta?.agent).toBe('arya');
  });

  it('preserves reasoning when provided', () => {
    const msg = makeAssistantMessage('answer', { reasoning: 'because' });
    expect(msg.reasoning).toBe('because');
  });

  it('omits agent key when not provided (no undefined leak)', () => {
    const msg = makeAssistantMessage('reply');
    expect('agent' in (msg.meta ?? {})).toBe(false);
  });
});

describe('makeToolMessage', () => {
  it('builds a tool message with structured toolResult', () => {
    const msg = makeToolMessage({
      toolCallId: 'call_1',
      toolName: 'read',
      toolArgs: { path: '/tmp/x' },
      toolResult: 'file body',
    });
    expect(msg.role).toBe('tool');
    expect(msg.content).toBe('');
    expect(msg.toolCallId).toBe('call_1');
    expect(msg.toolResult?.name).toBe('read');
    expect(msg.toolResult?.content).toBe('file body');
    expect(msg.toolResult?.error).toBe(false);
    expect(msg.meta?.toolArgs).toBe('{\n  "path": "/tmp/x"\n}');
  });

  it('propagates the error flag', () => {
    const msg = makeToolMessage({
      toolName: 'shell',
      toolResult: 'permission denied',
      toolError: true,
    });
    expect(msg.toolResult?.error).toBe(true);
  });
});

describe('makeSyntheticMessage', () => {
  it('stamps all known meta keys when provided', () => {
    const msg = makeSyntheticMessage({
      role: 'user',
      content: 'relay',
      agent: 'review',
      source: 'test',
      subagentRunId: 'run_1',
      display: { hidden: true },
    });
    expect(msg.role).toBe('user');
    expect(msg.meta?.agent).toBe('review');
    expect(msg.meta?.source).toBe('test');
    expect(msg.meta?.subagentRunId).toBe('run_1');
    expect(msg.display?.hidden).toBe(true);
  });

  it('omits optional meta keys cleanly', () => {
    const msg = makeSyntheticMessage({ role: 'system', content: 'note' });
    expect('agent' in (msg.meta ?? {})).toBe(false);
    expect('source' in (msg.meta ?? {})).toBe(false);
    expect('subagentRunId' in (msg.meta ?? {})).toBe(false);
  });

  it('propagates customType', () => {
    const msg = makeSyntheticMessage({
      role: 'assistant',
      content: 'header',
      customType: 'mu-agents.subagent',
    });
    expect(msg.customType).toBe('mu-agents.subagent');
  });
});
