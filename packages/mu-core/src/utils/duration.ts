/**
 * Compact duration formatter — `123ms`, `4.2s`, `1m 30s`.
 *
 * Channel-agnostic. Used by sub-agent run cards (companion + future
 * Telegram bot) and any host that needs to show "how long did X take".
 */

export function formatDuration(startTs: number, endTs?: number, now?: number): string {
  const end = endTs ?? now ?? Date.now();
  const ms = Math.max(0, end - startTs);
  if (ms < 1000) return `${ms}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const tenths = Math.round(totalSec * 10) / 10;
    return `${tenths}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec - min * 60);
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}
