import { Box, Text, useInput } from 'ink';
import React from 'react';
import { listSessions, type SessionFileSummary } from '../../sessionStore/jsonl';
import { getSessionsDir } from '../../sessionStore/paths';

const { useEffect, useState } = React;

export interface SessionsPickerProps {
  onSelect: (summary: SessionFileSummary) => void;
  onCancel: () => void;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

const MAX_VISIBLE = 8;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

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
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        borderBackgroundColor="#0a0a0a"
        backgroundColor="#0a0a0a"
        paddingX={1}
      >
        <Text color="red">Failed to list sessions: {error}</Text>
        <Text dimColor={true}>Press Esc to dismiss.</Text>
      </Box>
    );
  }

  if (!summaries) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderBackgroundColor="#0a0a0a"
        backgroundColor="#0a0a0a"
        paddingX={1}
      >
        <Text dimColor={true}>Loading sessions…</Text>
      </Box>
    );
  }

  if (summaries.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderBackgroundColor="#0a0a0a"
        backgroundColor="#0a0a0a"
        paddingX={1}
      >
        <Text dimColor={true}>No saved sessions in {getSessionsDir()}.</Text>
        <Text dimColor={true}>Press Esc to dismiss.</Text>
      </Box>
    );
  }

  let start = 0;
  let end = summaries.length;
  if (summaries.length > MAX_VISIBLE) {
    const half = Math.floor(MAX_VISIBLE / 2);
    start = clamp(cursor - half, 0, summaries.length - MAX_VISIBLE);
    end = start + MAX_VISIBLE;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      borderBackgroundColor="#0a0a0a"
      backgroundColor="#0a0a0a"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold={true} color="cyan">
          Sessions
        </Text>
      </Box>
      {summaries.slice(start, end).map((s, i) => {
        const absolute = start + i;
        const isCursor = absolute === cursor;
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
      <Box marginTop={1}>
        <Text dimColor={true}>↑/↓ navigate · Enter resume · Esc cancel</Text>
      </Box>
    </Box>
  );
}
