import { Box, Text } from 'ink';
import type { ChatMessage } from 'mu-core';
import { createContext, useContext, useEffect, useState } from 'react';
import type { SubagentRun, SubagentRunRegistry } from './subagentRun';

const MESSAGE_TYPE_SUBAGENT = 'mu-agents.subagent';

export const AGENT_MESSAGE_TYPES = {
  subagent: MESSAGE_TYPE_SUBAGENT,
};

/**
 * Optional registry context. The host wraps the chat view in
 * `SubagentRunsProvider` so the live `↳ subagent` header can subscribe to
 * its own run by id and reflect status updates in real time. When no
 * provider is present (e.g. tests), the renderer falls back to a static
 * header — the message stays readable, just not live.
 */
const RegistryContext = createContext<SubagentRunRegistry | null>(null);

export function SubagentRunsProvider({
  registry,
  children,
}: {
  registry: SubagentRunRegistry;
  children: React.ReactNode;
}) {
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

function useSubagentRun(id: string | undefined): SubagentRun | undefined {
  const registry = useContext(RegistryContext);
  const [run, setRun] = useState<SubagentRun | undefined>(() => (id && registry ? registry.get(id) : undefined));
  useEffect(() => {
    if (!(id && registry)) return;
    return registry.subscribeRun(id, (next) => setRun(next));
  }, [id, registry]);
  return run;
}

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

/**
 * Render a subagent invocation header. When a `SubagentRun` is available
 * for the message's `meta.subagentRunId`, the header reflects live status
 * and offers the keyboard hint to open the browser. Otherwise the original
 * static header is used.
 */
export function SubagentMessage({ msg }: { msg: ChatMessage }) {
  const color = msg.display?.color;
  const badge = msg.display?.badge ?? 'subagent';
  const runId = (msg.meta?.subagentRunId as string | undefined) ?? undefined;
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


