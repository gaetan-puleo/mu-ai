import { Box, Text } from 'ink';
import type React from 'react';
import { type CtxSnapshot, formatCount } from '../bridges';
import { Spinner, StatusBar } from '../primitives';

export function StatusBarContent({
  busy,
  queueLength,
  ctxSnapshot,
  ctxTotal,
}: {
  busy: boolean;
  queueLength: number;
  ctxSnapshot?: CtxSnapshot;
  ctxTotal?: number;
}): React.ReactElement {
  const left = busy ? (
    <Text dimColor={true}>
      <Spinner />
      {queueLength > 0 ? ` · ${queueLength} queued` : ''} · esc to abort
    </Text>
  ) : null;

  const right = (() => {
    if (!ctxSnapshot || ctxSnapshot.used === undefined) return '';
    const total = ctxSnapshot.total ?? ctxTotal;
    const usedStr = formatCount(ctxSnapshot.used);
    return total
      ? `ctx ${usedStr}/${formatCount(total)} (${Math.min(100, Math.round((ctxSnapshot.used / total) * 100))}%)`
      : `ctx ${usedStr}`;
  })();

  return (
    <Box flexShrink={0} marginBottom={1}>
      <StatusBar left={left} right={right} />
    </Box>
  );
}
