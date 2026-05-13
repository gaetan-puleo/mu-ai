import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { useUi } from '../../state/AppContext';
import type { SubRunSummary } from '../../state/uiStore';
import { useTheme } from '../../theme/ThemeContext';
import { StatusBar, type StatusBarSegment } from '../statusBar';

/**
 * Scoped restore of the old `SubagentBrowserPanel` (5c5ae8c, 145 LOC).
 * Doesn't embed the full subagent transcript — the new state model only
 * carries event-line strings, not the full message tree — but rebuilds:
 *  - the agent-coloured banner with status pill
 *  - the live elapsed timer (`useTickWhileRunning`)
 *  - the StatusBar segments (tool calls, elapsed, hint text)
 *  - a richer event list (all events, with windowing rather than the
 *    previous `slice(-5)` tail).
 */

const STATUS_LABEL: Record<SubRunSummary['status'], string> = {
  running: 'running…',
  completed: 'done',
  error: 'error',
};

function statusColor(status: SubRunSummary['status'], theme: ReturnType<typeof useTheme>): string {
  switch (status) {
    case 'running':
      return theme.colors.info;
    case 'error':
      return theme.colors.error;
    default:
      return theme.colors.success;
  }
}

function formatElapsed(run: SubRunSummary): string {
  const end = run.endedAt ?? Date.now();
  const ms = Math.max(0, end - run.startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, '0')}s`;
}

/**
 * Force a re-render every second while the run is still in flight so the
 * elapsed segment in the status bar / banner keeps ticking even when no
 * new events arrive. Shuts off as soon as the run carries an `endedAt`.
 */
function useTickWhileRunning(run: SubRunSummary | undefined): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!run || run.endedAt) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run]);
}

const VISIBLE_EVENTS = 12;

function SubagentRunCard({ run, theme }: { run: SubRunSummary; theme: ReturnType<typeof useTheme> }) {
  useTickWhileRunning(run);

  const banner = (
    <Box paddingX={1} borderStyle="single" borderColor={theme.colors.agent}>
      <Box flexGrow={1}>
        <Text color={theme.colors.agent} bold>
          ↳ {run.agentName}
        </Text>
        <Text dimColor> · {run.runId.slice(0, 8)}</Text>
      </Box>
      <Text color={statusColor(run.status, theme)} bold>
        {STATUS_LABEL[run.status]}
      </Text>
    </Box>
  );

  const segments: StatusBarSegment[] = [
    { text: `events: ${run.events.length}`, dim: true, align: 'left' },
    { text: formatElapsed(run), dim: true },
  ];

  const hiddenBefore = Math.max(0, run.events.length - VISIBLE_EVENTS);
  const visibleEvents = run.events.slice(-VISIBLE_EVENTS);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {banner}
      {run.task ? (
        <Box paddingX={1}>
          <Text dimColor wrap="wrap">
            {run.task}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" paddingX={1}>
        {hiddenBefore > 0 ? <Text dimColor>↑ {hiddenBefore} earlier event{hiddenBefore === 1 ? '' : 's'}</Text> : null}
        {visibleEvents.length === 0 ? (
          <Text dimColor>(no events yet)</Text>
        ) : (
          visibleEvents.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: event lines may repeat (e.g. progress dots); index disambiguates
            <Text key={`${i}-${line}`} dimColor wrap="wrap">
              · {line}
            </Text>
          ))
        )}
      </Box>
      <StatusBar segments={segments} />
    </Box>
  );
}

/**
 * Right-side panel showing all subagent runs for the current session,
 * newest first. Replaces the previous flat 48-line list with per-run
 * cards: agent-coloured banner, status pill, ticking elapsed timer,
 * windowed event log, and a per-run StatusBar.
 */
export function SubagentBrowser() {
  const theme = useTheme();
  const { subRuns } = useUi();
  const runs = Array.from(subRuns.values()).sort((a, b) => b.startedAt - a.startedAt);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.agent} paddingX={1} width="40%">
      <Text bold color={theme.colors.agentBadge}>
        Sub-agents ({runs.length})
      </Text>
      {runs.length === 0 ? (
        <Text dimColor>(none yet — invoke an @agent)</Text>
      ) : (
        runs.map((run) => <SubagentRunCard key={run.runId} run={run} theme={theme} />)
      )}
    </Box>
  );
}
