import { describe, expect, it } from 'bun:test';
import { formatRelativeTime, groupByDate } from './grouping';
import type { SessionSummary } from './types';

function summary(id: string, updatedAt: number): SessionSummary {
  return { id, title: id, createdAt: updatedAt, updatedAt, messageCount: 0 };
}

describe('groupByDate', () => {
  const NOW = new Date('2026-06-15T10:00:00Z').getTime();
  const MS_DAY = 24 * 60 * 60 * 1000;

  it('buckets sessions into Today/Yesterday/Last 7 days/Older', () => {
    const sessions: SessionSummary[] = [
      summary('today', NOW),
      summary('yesterday', NOW - MS_DAY),
      summary('threeDaysAgo', NOW - 3 * MS_DAY),
      summary('old', NOW - 30 * MS_DAY),
    ];
    const groups = groupByDate(sessions, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Last 7 days', 'Older']);
    expect(groups[0]?.items[0]?.id).toBe('today');
    expect(groups[1]?.items[0]?.id).toBe('yesterday');
  });

  it('omits empty buckets', () => {
    const sessions = [summary('only-today', NOW)];
    const groups = groupByDate(sessions, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Today');
  });

  it('preserves input order inside a bucket', () => {
    const a = summary('a', NOW);
    const b = summary('b', NOW - 1000);
    const groups = groupByDate([a, b], NOW);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('formatRelativeTime', () => {
  const NOW = 1_000_000_000_000;

  it('returns "just now" for under a minute', () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe('just now');
  });

  it('formats minutes', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
  });

  it('formats hours', () => {
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3h ago');
  });

  it('formats days', () => {
    expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe('2d ago');
  });

  it('falls back to locale date after a week', () => {
    const out = formatRelativeTime(NOW - 30 * 24 * 60 * 60_000, NOW);
    // We don't assert exact locale; just that it's NOT one of the relative forms.
    expect(out).not.toMatch(/(just now|m ago|h ago|d ago)/);
  });
});
