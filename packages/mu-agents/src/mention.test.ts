import { describe, expect, it } from 'bun:test';
import { parseMention } from './mention';

const KNOWN = new Set(['plan', 'build', 'review']);

describe('parseMention', () => {
  it('parses a leading mention with task', () => {
    const r = parseMention('@plan refactor auth', KNOWN);
    expect(r.mention).toEqual({ agent: 'plan', task: 'refactor auth' });
    expect(r.cleaned).toBe('refactor auth');
  });

  it('parses a bare mention (no task)', () => {
    const r = parseMention('@plan', KNOWN);
    expect(r.mention).toEqual({ agent: 'plan', task: '' });
    expect(r.cleaned).toBe('');
  });

  it('rejects mid-message mentions', () => {
    const r = parseMention('please @plan refactor', KNOWN);
    expect(r.mention).toBeUndefined();
    expect(r.cleaned).toBe('please @plan refactor');
  });

  it('rejects leading whitespace before @', () => {
    const r = parseMention('  @plan refactor', KNOWN);
    expect(r.mention).toBeUndefined();
  });

  it('ignores unknown agent names', () => {
    const r = parseMention('@nope hello', KNOWN);
    expect(r.mention).toBeUndefined();
    expect(r.cleaned).toBe('@nope hello');
  });

  it('treats subsequent @-tokens as part of the task text', () => {
    const r = parseMention('@plan reach out to @build for impl', KNOWN);
    expect(r.mention).toEqual({ agent: 'plan', task: 'reach out to @build for impl' });
  });

  it('supports multi-line task body', () => {
    const r = parseMention('@plan line one\nline two', KNOWN);
    expect(r.mention?.agent).toBe('plan');
    expect(r.mention?.task).toBe('line one\nline two');
  });
});
