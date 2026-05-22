import type { AgentsHandle, SubAgentEvent } from 'mu-agents';
import React from 'react';
import { formatToolCallArgs, formatToolResultPreview } from '../transcript';
import { insertToolResultRow, type ToolResultRow, type TranscriptRow } from '../types';

const { useEffect, useState } = React;

export interface SubAgentFeed {
  runId: string;
  childSessionId?: string;
  agentName: string;
  task: string;
  status: 'running' | 'completed' | 'error';
  rows: TranscriptRow[];
  streaming: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

function detailRecord(detail: unknown): Record<string, unknown> {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {};
}

function textDetail(detail: unknown): string {
  return typeof detail === 'string' ? detail : '';
}

function ensureFeed(feeds: SubAgentFeed[], event: SubAgentEvent): { feeds: SubAgentFeed[]; index: number } {
  const index = feeds.findIndex((feed) => feed.runId === event.runId);
  if (index >= 0) return { feeds, index };
  return {
    feeds: [
      ...feeds,
      {
        runId: event.runId,
        agentName: event.agentName,
        task: '',
        status: 'running',
        rows: [],
        streaming: '',
        startedAt: Date.now(),
      },
    ],
    index: feeds.length,
  };
}

function flushStreaming(feed: SubAgentFeed, fallback?: string): SubAgentFeed {
  const content = feed.streaming || fallback || '';
  if (!content) return feed;
  return {
    ...feed,
    streaming: '',
    rows: [
      ...feed.rows,
      {
        kind: 'message',
        id: `${feed.runId}:assistant:${feed.rows.length}`,
        role: 'assistant',
        content,
      },
    ],
  };
}

function replaceFeed(feeds: SubAgentFeed[], index: number, feed: SubAgentFeed): SubAgentFeed[] {
  const next = feeds.slice();
  next[index] = feed;
  return next;
}

function applyStarted(feed: SubAgentFeed, event: SubAgentEvent): SubAgentFeed {
  const detail = detailRecord(event.detail);
  const task = typeof detail.task === 'string' ? detail.task : feed.task;
  const childSessionId = typeof detail.sessionId === 'string' ? detail.sessionId : feed.childSessionId;
  return {
    ...feed,
    childSessionId,
    task,
    status: 'running',
    rows: task
      ? [
          {
            kind: 'message',
            id: `${event.runId}:task`,
            role: 'user',
            content: task,
          },
        ]
      : feed.rows,
  };
}

function applyToolCall(feed: SubAgentFeed, event: SubAgentEvent): SubAgentFeed {
  const detail = detailRecord(event.detail);
  const callId = typeof detail.id === 'string' ? detail.id : undefined;
  const name = typeof detail.name === 'string' ? detail.name : 'tool';
  const rawArgs = typeof detail.arguments === 'string' ? detail.arguments : '';
  const flushed = flushStreaming(feed);
  return {
    ...flushed,
    rows: [
      ...flushed.rows,
      {
        kind: 'tool_call',
        id: `${event.runId}:tool-call:${flushed.rows.length}`,
        callId,
        name,
        argsPreview: formatToolCallArgs(rawArgs),
      },
    ],
  };
}

function applyToolResult(feed: SubAgentFeed, event: SubAgentEvent): SubAgentFeed {
  const detail = detailRecord(event.detail);
  const callId = typeof detail.toolCallId === 'string' ? detail.toolCallId : undefined;
  const name = typeof detail.name === 'string' ? detail.name : 'tool';
  const content = typeof detail.content === 'string' ? detail.content : '';
  const result: ToolResultRow = {
    kind: 'tool_result',
    id: `${event.runId}:tool-result:${feed.rows.length}`,
    callId,
    name,
    preview: formatToolResultPreview(content),
    error: detail.error === true,
  };
  return {
    ...feed,
    rows: insertToolResultRow(feed.rows, result),
  };
}

function applyCompleted(feed: SubAgentFeed, event: SubAgentEvent): SubAgentFeed {
  const detail = detailRecord(event.detail);
  const finalContent = typeof detail.content === 'string' ? detail.content : undefined;
  return { ...flushStreaming(feed, finalContent), status: 'completed', completedAt: Date.now() };
}

function applyError(feed: SubAgentFeed, event: SubAgentEvent): SubAgentFeed {
  const error = textDetail(event.detail) || 'unknown error';
  const flushed = flushStreaming(feed);
  return {
    ...flushed,
    status: 'error',
    error,
    completedAt: Date.now(),
    rows: [
      ...flushed.rows,
      {
        kind: 'message',
        id: `${event.runId}:error:${flushed.rows.length}`,
        role: 'system',
        content: `error: ${error}`,
      },
    ],
  };
}

function reduceSubAgentEvent(prev: SubAgentFeed[], event: SubAgentEvent): SubAgentFeed[] {
  const ensured = ensureFeed(prev, event);
  const feeds = ensured.feeds;
  const index = ensured.index;
  let feed = feeds[index] as SubAgentFeed;

  if (event.type === 'started') {
    feed = applyStarted(feed, event);
    return replaceFeed(feeds, index, feed);
  }

  if (event.type === 'content') {
    feed = { ...feed, streaming: feed.streaming + textDetail(event.detail), status: 'running' };
    return replaceFeed(feeds, index, feed);
  }

  if (event.type === 'tool_call') {
    feed = applyToolCall(feed, event);
    return replaceFeed(feeds, index, feed);
  }

  if (event.type === 'tool_result') {
    feed = applyToolResult(feed, event);
    return replaceFeed(feeds, index, feed);
  }

  if (event.type === 'completed') {
    feed = applyCompleted(feed, event);
    return replaceFeed(feeds, index, feed);
  }

  if (event.type === 'error') {
    feed = applyError(feed, event);
    return replaceFeed(feeds, index, feed);
  }

  return feeds;
}

export function useSubAgentFeeds(agentsHandle: AgentsHandle | undefined, parentSessionId: string): SubAgentFeed[] {
  const [feeds, setFeeds] = useState<SubAgentFeed[]>([]);

  useEffect(() => {
    setFeeds([]);
    if (!agentsHandle) return;
    return agentsHandle.onSubAgentEvent(parentSessionId, (event) => {
      setFeeds((prev) => reduceSubAgentEvent(prev, event));
    });
  }, [agentsHandle, parentSessionId]);

  return feeds;
}
