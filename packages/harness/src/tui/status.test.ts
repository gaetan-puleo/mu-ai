import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { buildStatusParts, formatTokens, spinnerFrame } from './status';

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
