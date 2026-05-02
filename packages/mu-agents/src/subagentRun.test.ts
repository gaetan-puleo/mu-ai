import { describe, expect, it } from 'bun:test';
import type { ChatMessage } from 'mu-core';
import { createSubagentRunRegistry, type SubagentRun } from './subagentRun';
import type { AgentDefinition } from './types';

const NOOP = (): void => {
  // intentional: tests pass an abort handle they don't use.
};

const AGENT: AgentDefinition = {
  name: 'review',
  description: 'Review agent',
  tools: [],
  systemPrompt: 'system',
  type: 'subagent',
};

const INITIAL: ChatMessage[] = [
  { role: 'system', content: 'system' },
  { role: 'user', content: 'task' },
];

describe('SubagentRunRegistry', () => {
  it('start registers a run and emits to subscribers', () => {
    const reg = createSubagentRunRegistry();
    const seen: SubagentRun[][] = [];
    reg.subscribe((runs) => seen.push(runs));
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual([]);

    reg.start({ id: 'r1', agent: AGENT, task: 'go', initialMessages: INITIAL, abort: NOOP });
    expect(seen[seen.length - 1].length).toBe(1);
    expect(reg.list()[0].id).toBe('r1');
  });

  it('update mutates the run and notifies per-run subscribers', () => {
    const reg = createSubagentRunRegistry();
    const { update } = reg.start({ id: 'r1', agent: AGENT, task: 'go', initialMessages: INITIAL, abort: NOOP });
    let last: SubagentRun | undefined;
    reg.subscribeRun('r1', (run) => {
      last = run;
    });
    update({ messages: [...INITIAL, { role: 'assistant', content: 'hi' }] });
    expect(last?.messages.length).toBe(3);
  });

  it('finish stamps finishedAt and writes to disk', async () => {
    const writes: [string, ChatMessage[]][] = [];
    const reg = createSubagentRunRegistry();
    reg.setSessionWriter(async (path, msgs) => {
      writes.push([path, msgs]);
    });
    const { finish } = reg.start({
      id: 'r1',
      agent: AGENT,
      task: 'go',
      initialMessages: INITIAL,
      sessionPath: '/tmp/r1.jsonl',
      abort: NOOP,
    });
    await finish({ status: 'done', finalContent: 'ok' });
    const run = reg.get('r1');
    expect(run?.status).toBe('done');
    expect(run?.finishedAt).toBeNumber();
    // The flush at finish() always writes regardless of debounce.
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes.at(-1)?.[0]).toBe('/tmp/r1.jsonl');
  });

  it('hydrate inserts pre-completed runs in chronological order', () => {
    const reg = createSubagentRunRegistry();
    reg.start({ id: 'live', agent: AGENT, task: 'now', initialMessages: INITIAL, abort: NOOP });
    reg.hydrate({
      id: 'old',
      agentName: 'review',
      task: 'old task',
      messages: INITIAL,
      status: 'done',
      startedAt: Date.now() - 60_000,
      abort: NOOP,
    });
    expect(reg.list().map((r) => r.id)).toEqual(['old', 'live']);
  });

  it('clear drops every run and emits', () => {
    const reg = createSubagentRunRegistry();
    reg.start({ id: 'r1', agent: AGENT, task: 'go', initialMessages: INITIAL, abort: NOOP });
    let lastSnapshot: SubagentRun[] | null = null;
    reg.subscribe((runs) => {
      lastSnapshot = runs;
    });
    reg.clear();
    expect(reg.list()).toEqual([]);
    expect(lastSnapshot).toEqual([]);
  });
});
