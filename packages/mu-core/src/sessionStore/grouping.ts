/**
 * Channel-agnostic session list grouping + relative-time formatting.
 *
 * Used by hosts that surface a session list (companion drawer,
 * TUI `/sessions` screen, future Telegram bot). Lives in mu-core so
 * every host gets identical bucket labels and formatting.
 */

import type { SessionSummary } from './types';

export type SessionGroupLabel = 'Today' | 'Yesterday' | 'Last 7 days' | 'Older';

export interface SessionGroup {
  label: SessionGroupLabel;
  items: SessionSummary[];
}

/**
 * Group sessions into Today / Yesterday / Last 7 days / Older buckets,
 * preserving the input order inside each bucket. Empty buckets are
 * omitted from the output.
 *
 * @param now optional current-time override (epoch ms) for testing.
 */
export function groupByDate(sessions: SessionSummary[], now?: number): SessionGroup[] {
  const nowDate = new Date(now ?? Date.now());
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const today: SessionSummary[] = [];
  const yesterday: SessionSummary[] = [];
  const lastWeek: SessionSummary[] = [];
  const older: SessionSummary[] = [];

  for (const s of sessions) {
    if (s.updatedAt >= startOfToday) today.push(s);
    else if (s.updatedAt >= startOfYesterday) yesterday.push(s);
    else if (s.updatedAt >= sevenDaysAgo) lastWeek.push(s);
    else older.push(s);
  }

  const groups: SessionGroup[] = [];
  if (today.length) groups.push({ label: 'Today', items: today });
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
  if (lastWeek.length) groups.push({ label: 'Last 7 days', items: lastWeek });
  if (older.length) groups.push({ label: 'Older', items: older });
  return groups;
}

/**
 * Compact relative-time formatter — "just now", "5m ago", "3h ago",
 * "2d ago". Falls back to a locale date string after a week.
 *
 * @param now optional current-time override (epoch ms) for testing.
 */
export function formatRelativeTime(ts: number, now?: number): string {
  const diffMs = (now ?? Date.now()) - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}
