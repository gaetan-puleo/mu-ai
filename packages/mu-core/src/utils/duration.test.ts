import { describe, expect, it } from 'bun:test';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('formats sub-second durations in ms', () => {
    expect(formatDuration(0, 250)).toBe('250ms');
    expect(formatDuration(0, 999)).toBe('999ms');
  });

  it('formats seconds with one decimal', () => {
    expect(formatDuration(0, 1_500)).toBe('1.5s');
    expect(formatDuration(0, 59_900)).toBe('59.9s');
  });

  it('formats minutes + seconds', () => {
    expect(formatDuration(0, 60_000)).toBe('1m');
    expect(formatDuration(0, 90_000)).toBe('1m 30s');
    expect(formatDuration(0, 120_000)).toBe('2m');
  });

  it('uses `now` when endTs is omitted', () => {
    expect(formatDuration(0, undefined, 500)).toBe('500ms');
  });

  it('treats negative durations as 0', () => {
    expect(formatDuration(1000, 500)).toBe('0ms');
  });
});
