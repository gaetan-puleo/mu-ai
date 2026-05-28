import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { buildStatusParts, formatTokens, spinnerFrame, statusFromEvent } from './status';

describe('formatTokens', () => {
  it('returns small integers as plain strings', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(42)).toBe('42');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with a `k` suffix and one decimal', () => {
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(9999)).toBe('10k');
    expect(formatTokens(12_345)).toBe('12.3k');
  });

  it('rounds when the input is fractional', () => {
    expect(formatTokens(0.4)).toBe('0');
    expect(formatTokens(0.6)).toBe('1');
  });
});

describe('spinnerFrame', () => {
  it('cycles through the 10 braille frames', () => {
    const frames = new Set<string>();
    for (let i = 0; i < 10; i++) frames.add(spinnerFrame(i));
    expect(frames.size).toBe(10);
  });

  it('wraps modulo the frame count', () => {
    expect(spinnerFrame(0)).toBe(spinnerFrame(10));
    expect(spinnerFrame(3)).toBe(spinnerFrame(13));
  });
});

describe('buildStatusParts', () => {
  it('returns empty left and only-context right when context is set', () => {
    expect(buildStatusParts('1.2k/4k')).toEqual({ left: [], right: ['1.2k/4k'] });
  });

  it('returns empty right when no context is supplied', () => {
    expect(buildStatusParts(undefined)).toEqual({ left: [], right: [] });
    expect(buildStatusParts('')).toEqual({ left: [], right: [] });
  });
});

describe('statusFromEvent', () => {
  it('labels streaming events', () => {
    expect(statusFromEvent({ type: 'assistant_start' })).toBe('streaming...');
    expect(statusFromEvent({ type: 'assistant_delta', content: 'x' })).toBe('streaming...');
  });

  it('returns to ready on assistant_message and tool_result', () => {
    expect(statusFromEvent({ type: 'assistant_message', message: { role: 'assistant', content: 'x' } })).toBe('ready');
    expect(statusFromEvent({ type: 'tool_result', message: { role: 'tool', content: 'x', tool_id: 't' } })).toBe('ready');
  });

  it('labels reasoning events', () => {
    expect(statusFromEvent({ type: 'reasoning_delta', content: 'x' })).toBe('reasoning...');
    expect(statusFromEvent({ type: 'reasoning_message', content: 'x' })).toBe('reasoning...');
  });

  it('includes the tool name on tool_call', () => {
    expect(statusFromEvent({ type: 'tool_call', call: { id: 'c1', name: 'read', args: '{}' } })).toBe('tool: read');
  });

  it('labels error events', () => {
    expect(statusFromEvent({ type: 'error', error: new Error('boom') })).toBe('error');
  });

  it('returns undefined for events the host should ignore', () => {
    expect(statusFromEvent({ type: 'user_message', message: { role: 'user', content: 'x' } })).toBeUndefined();
    expect(statusFromEvent({ type: 'queue_update', steering: [], followUp: [] })).toBeUndefined();
  });
});
