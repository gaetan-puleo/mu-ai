import { Box, Text } from 'ink';
import React from 'react';
import { USER_BACKGROUND } from '../bridges';
import { MessagesViewport, type ViewportRow } from '../primitives';
import type { TranscriptRow } from '../types';
import { MarkdownText, markdownToPlainText } from './MarkdownText';

const { useMemo } = React;

export interface TranscriptViewProps {
  rows: TranscriptRow[];
  streaming: string;
  streamingReasoning: string;
  queuedView: Array<{ id: string; text: string }>;
  scrollable: boolean;
}

const dim = (text: string): React.ReactElement => (
  <Box flexDirection="column">
    <Text dimColor={true}>{text}</Text>
  </Box>
);

const thinking = (text: string): React.ReactElement => (
  <Box
    flexDirection="column"
    borderStyle="single"
    borderTop={false}
    borderBottom={false}
    borderRight={false}
    borderColor="gray"
    marginX={1}
    marginBottom={1}
    paddingX={1}
  >
    <Text>
      <Text color="#8a6d1f">Thinking:</Text> <Text dimColor={true}>{text}</Text>
    </Text>
  </Box>
);

const assistantMarkdown = (text: string): React.ReactElement => (
  <Box flexDirection="column" marginBottom={1}>
    <Box paddingX={1}>
      <MarkdownText>{text}</MarkdownText>
    </Box>
  </Box>
);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: row-type dispatch is inherently branching
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: single-pass row builder for viewport rendering
function buildViewportRows(
  history: TranscriptRow[],
  streaming: string,
  streamingReasoning: string,
  queuedView: Array<{ id: string; text: string }>,
): ViewportRow[] {
  const result: ViewportRow[] = [];
  for (const row of history) {
    if (row.kind === 'tool_call') {
      const label = row.argsPreview ? `▸ ${row.name}(${row.argsPreview})` : `▸ ${row.name}()`;
      result.push({
        id: row.id,
        text: label,
        marginBottom: 0,
        style: { color: 'gray', dimColor: true },
        node: (
          <Box flexDirection="column">
            <Text color="gray" dimColor={true}>
              {label}
            </Text>
          </Box>
        ),
      });
      continue;
    }
    if (row.kind === 'tool_result') {
      const prefix = row.error ? '  ↳ error: ' : '  ↳ ';
      const label = `${prefix}${row.preview || '(no output)'}`;
      const color = row.error ? 'red' : 'gray';
      result.push({
        id: row.id,
        text: label,
        marginBottom: 1,
        style: { color, dimColor: !row.error },
        node: (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={color} dimColor={!row.error}>
              {label}
            </Text>
          </Box>
        ),
      });
      continue;
    }
    if (!(row.content || row.reasoning)) continue;
    const isUser = row.role === 'user';
    const isSystem = row.role === 'system';
    if (row.reasoning) {
      const reasoning = row.reasoning.trim();
      if (!reasoning) continue;
      result.push({
        id: `${row.id}#r`,
        text: reasoning,
        marginBottom: 1,
        style: { dimColor: true },
        node: thinking(reasoning),
      });
    }
    if (row.content) {
      if (isUser) {
        result.push({
          id: row.id,
          text: row.content,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: USER_BACKGROUND,
          marginBottom: 1,
          node: (
            <Box flexDirection="column" marginBottom={1}>
              <Box
                flexDirection="column"
                backgroundColor={USER_BACKGROUND}
                borderStyle="single"
                borderTop={false}
                borderBottom={false}
                borderRight={false}
                borderLeftColor={row.agentColor ?? 'cyan'}
                borderLeftBackgroundColor={USER_BACKGROUND}
                paddingX={1}
                paddingY={1}
              >
                <Text>{row.content}</Text>
              </Box>
            </Box>
          ),
        });
      } else if (isSystem) {
        result.push({
          id: row.id,
          text: row.content,
          marginBottom: 0,
          style: { dimColor: true },
          node: dim(row.content),
        });
      } else {
        const text = markdownToPlainText(row.content);
        result.push({
          id: row.id,
          text,
          marginBottom: 1,
          node: assistantMarkdown(row.content),
        });
      }
    }
  }
  if (streamingReasoning) {
    const reasoning = streamingReasoning.trim();
    if (reasoning) {
      result.push({
        id: '__streaming__#r',
        text: reasoning,
        marginBottom: 1,
        style: { dimColor: true },
        node: thinking(reasoning),
      });
    }
  }
  if (streaming) {
    const text = markdownToPlainText(streaming);
    result.push({
      id: '__streaming__',
      text,
      marginBottom: 1,
      node: assistantMarkdown(streaming),
    });
  }
  for (const q of queuedView) {
    result.push({
      id: `queued-${q.id}`,
      text: q.text,
      marginBottom: 1,
      style: { dimColor: true },
      node: (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor={true}>
            <Text color="yellow">[queued] </Text>
            {q.text}
          </Text>
        </Box>
      ),
    });
  }
  return result;
}

export function TranscriptView({
  rows,
  streaming,
  streamingReasoning,
  queuedView,
  scrollable,
}: TranscriptViewProps): React.ReactElement {
  const viewportRows = useMemo(
    () => buildViewportRows(rows, streaming, streamingReasoning, queuedView),
    [rows, streaming, streamingReasoning, queuedView],
  );
  return <MessagesViewport rows={viewportRows} scrollable={scrollable} />;
}
