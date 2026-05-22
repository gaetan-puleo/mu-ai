import { Box, Text } from 'ink';
import type React from 'react';
import type { SubAgentFeed } from '../hooks/useSubAgentFeeds';

export function SubAgentBanner({
  feeds,
  focusedRunId,
  navPrefix,
}: {
  feeds: SubAgentFeed[];
  focusedRunId: string | null;
  navPrefix: boolean;
}): React.ReactElement | null {
  if (feeds.length === 0 && !focusedRunId) return null;
  const focused = focusedRunId ? feeds.find((feed) => feed.runId === focusedRunId) : undefined;
  const running = feeds.filter((feed) => feed.status === 'running').length;
  const prefix = navPrefix ? 'nav: ' : '';

  if (!focused) {
    const summary = running > 0 ? `${running} running` : `${feeds.length} subagent${feeds.length === 1 ? '' : 's'}`;
    return (
      <Box flexShrink={0} marginBottom={1} paddingX={1} borderStyle="single" borderColor="gray">
        <Text>
          <Text color="cyan">[parent]</Text> {summary} · {prefix}ctrl+x down open · ctrl+x left/right switch
        </Text>
      </Box>
    );
  }

  const index = feeds.findIndex((feed) => feed.runId === focused.runId) + 1;
  const color = focused.status === 'error' ? 'red' : focused.status === 'completed' ? 'green' : 'yellow';

  return (
    <Box flexShrink={0} marginBottom={1} paddingX={1} borderStyle="single" borderColor={color}>
      <Text>
        <Text color="cyan">
          [subagent {index}/{feeds.length}]
        </Text>{' '}
        <Text bold={true}>{focused.agentName}</Text> · <Text color={color}>{focused.status}</Text> · {prefix}ctrl+x up
        parent · ctrl+x left/right switch
      </Text>
    </Box>
  );
}
