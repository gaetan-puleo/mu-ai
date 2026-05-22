import { describe, expect, it } from 'bun:test';
import { formatToolCallArgs, formatToolResultPreview, truncate } from './transcript';

describe('truncate', () => {
  it('passes through strings shorter than maxLen', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('adds ellipsis when truncating', () => {
    expect(truncate('hello world', 6)).toBe('hello…');
  });

  it('handles maxLen of 0 / 1 without crashing', () => {
    expect(truncate('abcd', 1)).toBe('…');
    expect(truncate('abcd', 0)).toBe('…');
  });
});

describe('formatToolCallArgs', () => {
  it('shows only string values for the bash case', () => {
    expect(formatToolCallArgs('{"command":"ls -la"}')).toBe('ls -la');
  });

  it('comma-joins multiple values in object-declaration order', () => {
    expect(formatToolCallArgs('{"path":"/x","limit":100}')).toBe('/x, 100');
  });

  it('JSON-stringifies non-string values', () => {
    expect(formatToolCallArgs('{"flags":["a","b"],"force":true}')).toBe('["a","b"], true');
  });

  it('skips undefined entries (objects round-tripped through JSON cannot encode undefined, but providers sometimes emit them via JSON.stringify({a: undefined}) → "{}")', () => {
    expect(formatToolCallArgs('{}')).toBe('');
  });

  it('returns truncated raw text when JSON.parse fails', () => {
    const broken = '{"command":"ls -';
    expect(formatToolCallArgs(broken)).toBe(broken);
  });

  it('returns toString for non-object JSON parse results', () => {
    expect(formatToolCallArgs('"raw"')).toBe('raw');
    expect(formatToolCallArgs('42')).toBe('42');
    expect(formatToolCallArgs('null')).toBe('');
  });

  it('truncates long joined values', () => {
    const long = 'a'.repeat(200);
    const out = formatToolCallArgs(`{"x":"${long}"}`, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('formatToolResultPreview', () => {
  it('returns empty for empty input', () => {
    expect(formatToolResultPreview('')).toBe('');
  });

  it('returns the first non-empty trimmed line', () => {
    expect(formatToolResultPreview('\n  \nactual content\nlater line')).toBe('actual content');
  });

  it('returns the whole content when it has no newlines', () => {
    expect(formatToolResultPreview('one line of output')).toBe('one line of output');
  });

  it('truncates long lines', () => {
    const long = 'x'.repeat(500);
    const out = formatToolResultPreview(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty when content has only whitespace lines', () => {
    expect(formatToolResultPreview('\n\n   \n\t\n')).toBe('');
  });
});
