import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-core';
import type { SubagentRun } from 'mu-agents';
import { useContext, useEffect, useState } from 'react';
import { SubagentRunsRegistryContext } from '../../SubagentRunsProvider';

/**
 * Ink renderer for `customType === 'mu-agents.subagent'` synthetic
 * messages — the live `↳ subagent` header in the parent transcript.
 *
 * Moved here from mu-agents/renderers.tsx so mu-agents stays
 * renderer-agnostic (no Ink/React dep for non-TUI hosts like arya).
 * mu-coding wires this renderer up via `registry.registerMessageRenderer`
 * at activate time.
 */

function statusGlyph(status: SubagentRun['status']): string {
  switch (status) {
    case 'running':
      return '⠋';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'aborted':
      return '⊘';
    default:
      return '·';
  }
}

function useSubagentRun(id: string | undefined): SubagentRun | undefined {
  const registry = useContext(SubagentRunsRegistryContext);
  const [run, setRun] = useState<SubagentRun | undefined>(() =>
    id && registry ? registry.get(id) : undefined,
  );
  useEffect(() => {
    if (!(id && registry)) return;
    return registry.subscribeRun(id, (next) => setRun(next));
  }, [id, registry]);
  return run;
}

export function SubagentMessage({ msg }: { msg: ChatMessage }) {
  const color = msg.display?.color;
  const badge = msg.display?.badge ?? 'subagent';
  const runId = msg.meta?.subagentRunId;
  const run = useSubagentRun(runId);

  const status = run?.status;
  const glyph = status ? statusGlyph(status) : '↳';
  const trailing =
    status === 'running'
      ? ' (running… · Ctrl+X ↓ to view)'
      : status === 'done'
        ? ' (done · Ctrl+X ↓ to view)'
        : status === 'error'
          ? ' (error · Ctrl+X ↓ to view)'
          : status === 'aborted'
            ? ' (aborted · Ctrl+X ↓ to view)'
            : '';

  // Only show the run's final content. Earlier versions fell back to
  // `msg.content` (which carries the dispatched task) so the user's
  // input echoed underneath the header during the run — read as the
  // user's message appearing twice. Keep the body empty until the run
  // finishes; the subagent browser panel (`Ctrl+X ↓`) is the place to
  // watch live progress.
  const body = run?.finalContent ?? '';

  return (
    <Box flexDirection="column" flexShrink={0} marginY={1} paddingX={1}>
      <Text color={color} bold={true}>
        {glyph} {badge}
        {trailing}
      </Text>
      {body ? (
        <Text wrap="wrap" dimColor={true}>
          {body}
        </Text>
      ) : null}
    </Box>
  );
}
