import { describe, expect, it } from 'bun:test';
import type { ProviderConfig } from 'mu-core';
import { parseOpenAIChunk, parseOpenAIUsage, toOpenAIMessages } from './format';

const cfg: ProviderConfig = {
  baseUrl: 'http://x',
  maxTokens: 1,
  temperature: 0,
  streamTimeoutMs: 1,
};

describe('toOpenAIMessages', () => {
  it('prepends system prompt when present', () => {
    const out = toOpenAIMessages([{ role: 'user', content: 'hi' }], { ...cfg, systemPrompt: 'sys' });
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('serialises tool calls on assistant messages', () => {
    const out = toOpenAIMessages(
      [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', function: { name: 'bash', arguments: '{}' } }],
        },
      ],
      cfg,
    );
    expect(out[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: '{}' } }],
    });
  });

  it('passes tool_call_id on tool messages', () => {
    const out = toOpenAIMessages([{ role: 'tool', content: 'ok', toolCallId: 'c1' }], cfg);
    expect(out[0]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
  });
});

describe('parseOpenAIChunk', () => {
  it('returns done on [DONE]', () => {
    expect(parseOpenAIChunk('[DONE]')).toEqual({ kind: 'done' });
  });

  it('parses content delta', () => {
    const evt = parseOpenAIChunk(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }));
    expect(evt).toEqual({ kind: 'chunk', chunk: { type: 'content', text: 'hi' } });
  });

  it('parses reasoning_content delta', () => {
    const evt = parseOpenAIChunk(JSON.stringify({ choices: [{ delta: { reasoning_content: 'think' } }] }));
    expect(evt).toEqual({ kind: 'chunk', chunk: { type: 'reasoning', text: 'think' } });
  });

  it('parses usage chunk', () => {
    const evt = parseOpenAIChunk(
      JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    );
    expect(evt?.kind).toBe('usage');
  });

  it('returns null on empty deltas', () => {
    expect(parseOpenAIChunk(JSON.stringify({ choices: [{ delta: {} }] }))).toBeNull();
  });

  it('tolerates malformed JSON', () => {
    expect(parseOpenAIChunk('{not-json')).toBeNull();
  });
});

describe('parseOpenAIUsage', () => {
  it('extracts cached tokens', () => {
    const u = parseOpenAIUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 60 },
      },
    });
    expect(u?.cachedPromptTokens).toBe(60);
  });
});
