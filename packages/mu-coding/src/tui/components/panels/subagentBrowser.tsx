import { Box, Text } from 'ink';
import { useUi } from '../../state/AppContext';
import type { SubRunSummary } from '../../state/uiStore';
import { useTheme } from '../../theme/ThemeContext';

function statusColor(status: SubRunSummary['status'], theme: ReturnType<typeof useTheme>): string {
  if (status === 'running') return theme.colors.info;
  if (status === 'error') return theme.colors.error;
  return theme.colors.success;
}

function fmtElapsed(run: SubRunSummary): string {
  const end = run.endedAt ?? Date.now();
  return `${Math.round((end - run.startedAt) / 1000)}s`;
}

export function SubagentBrowser() {
  const theme = useTheme();
  const { subRuns } = useUi();
  const runs = Array.from(subRuns.values()).sort((a, b) => b.startedAt - a.startedAt);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.agent} paddingX={1} width="40%">
      <Text bold color={theme.colors.agentBadge}>
        Sub-agents
      </Text>
      {runs.length === 0 ? (
        <Text dimColor>(none yet)</Text>
      ) : (
        runs.map((run) => (
          <Box key={run.runId} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={statusColor(run.status, theme)}>● </Text>
              <Text bold>{run.agentName}</Text>
              <Text dimColor> · {fmtElapsed(run)}</Text>
            </Text>
            {run.task ? <Text dimColor>{run.task.slice(0, 80)}</Text> : null}
            {run.events.slice(-5).map((line, i) => (
              <Text key={i} dimColor>
                · {line}
              </Text>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}
