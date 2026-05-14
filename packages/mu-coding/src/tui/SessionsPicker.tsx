import { Box, Text, useInput } from 'ink';
import React from 'react';
import { listSessions, type SessionFileSummary } from '../sessionStore/jsonl';
import { getSessionsDir } from '../sessionStore/paths';

const { useEffect, useState } = React;

export interface SessionsPickerProps {
  /** Called with the picked session's id and file path. */
  onSelect: (summary: SessionFileSummary) => void;
  /** Called when the user dismisses without picking (Esc / q). */
  onCancel: () => void;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

/**
 * Read-only picker that lists session files from `getSessionsDir()`.
 *
 * Intentionally minimal — no per-row preview, no grouping. Both are good
 * follow-ups but cost: preview means a second file read per row, grouping
 * needs a relative-time formatter and a more complex layout. Today the list
 * is short enough that a flat newest-first view is fine.
 */
export function SessionsPicker({ onSelect, onCancel }: SessionsPickerProps): React.ReactElement {
  const [summaries, setSummaries] = useState<SessionFileSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    listSessions(getSessionsDir())
      .then(setSummaries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onCancel();
      return;
    }
    if (!summaries || summaries.length === 0) return;
    if (key.upArrow) setCursor((c) => (c - 1 + summaries.length) % summaries.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % summaries.length);
    else if (key.return) {
      const picked = summaries[cursor];
      if (picked) onSelect(picked);
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red">Failed to list sessions: {error}</Text>
        <Text dimColor={true}>Press Esc to dismiss.</Text>
      </Box>
    );
  }

  if (!summaries) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor={true}>Loading sessions…</Text>
      </Box>
    );
  }

  if (summaries.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor={true}>No saved sessions in {getSessionsDir()}.</Text>
        <Text dimColor={true}>Press Esc to dismiss.</Text>
      </Box>
    );
  }

  // Cap to the most recent 12 so very long lists don't overflow the modal.
  const visible = summaries.slice(0, 12);
  const hidden = summaries.length - visible.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold={true} color="cyan">
          Sessions
        </Text>
      </Box>
      {visible.map((s, i) => {
        const isCursor = i === cursor;
        const cwd = s.header.cwd ?? '';
        const model = s.header.model ?? 'unknown';
        return (
          <Text key={s.id} color={isCursor ? 'cyan' : undefined}>
            {isCursor ? '› ' : '  '}
            {formatTime(s.mtimeMs)}
            {'  '}
            <Text dimColor={true}>
              {model} · {cwd}
            </Text>
          </Text>
        );
      })}
      {hidden > 0 ? <Text dimColor={true}>… {hidden} older</Text> : null}
      <Box marginTop={1}>
        <Text dimColor={true}>↑/↓ navigate · Enter resume · Esc cancel</Text>
      </Box>
    </Box>
  );
}
