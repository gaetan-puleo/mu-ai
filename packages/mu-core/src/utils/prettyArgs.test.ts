import { describe, expect, it } from 'bun:test';
import { prettyToolArgs } from './prettyArgs';

describe('prettyToolArgs', () => {
  it('formats an object as pretty JSON', () => {
    expect(prettyToolArgs({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('re-prints a JSON string', () => {
    expect(prettyToolArgs('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns non-JSON strings verbatim', () => {
    expect(prettyToolArgs('plain text')).toBe('plain text');
  });

  it('truncates long output with an ellipsis', () => {
    const long = 'x'.repeat(800);
    const out = prettyToolArgs(long, 50);
    expect(out.length).toBe(51); // 50 chars + …
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles null and undefined', () => {
    expect(prettyToolArgs(null)).toBe('');
    expect(prettyToolArgs(undefined)).toBe('');
  });

  it('falls back to String() on non-serializable input', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const out = prettyToolArgs(circular);
    expect(typeof out).toBe('string');
  });
});
