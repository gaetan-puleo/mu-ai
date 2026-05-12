import { describe, expect, it } from 'bun:test';
import { createApprovalGateway } from './approval';
import { createSubagentRunRegistry } from './subagentRun';
import type { AgentDefinition } from './types';

const FAKE_AGENT: AgentDefinition = {
  name: 'review',
  description: 'review agent',
  type: 'subagent',
  color: '#abc',
  systemPrompt: 'system',
  tools: ['*'],
};

describe('SubagentRunRegistry — snapshot surface', () => {
  it('getSnapshot returns a projected snapshot for a started run', () => {
    const registry = createSubagentRunRegistry();
    registry.start({
      id: 'r1',
      agent: FAKE_AGENT,
      task: 'audit',
      initialMessages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'audit it' },
      ],
      abort: () => undefined,
    });
    const snap = registry.getSnapshot('r1');
    expect(snap).toBeDefined();
    expect(snap?.runId).toBe('r1');
    expect(snap?.agentId).toBe('review');
    expect(snap?.agentColor).toBe('#abc');
    expect(snap?.status).toBe('running');
    expect(snap?.timeline.length).toBe(2);
    expect(snap?.toolCount).toBe(0);
  });

  it('subscribeAllSnapshots replays existing snapshots on subscribe', () => {
    const registry = createSubagentRunRegistry();
    registry.start({
      id: 'r1',
      agent: FAKE_AGENT,
      task: 'audit',
      initialMessages: [],
      abort: () => undefined,
    });
    const seen: string[] = [];
    registry.subscribeAllSnapshots((s) => seen.push(s.runId));
    expect(seen).toContain('r1');
  });

  it('emits on update + finish transitions', async () => {
    const registry = createSubagentRunRegistry();
    const seen: Array<{ status: string; final?: string }> = [];
    registry.subscribeAllSnapshots((s) =>
      seen.push({ status: s.status, final: s.finalContent }),
    );
    const handle = registry.start({
      id: 'r1',
      agent: FAKE_AGENT,
      task: 'x',
      initialMessages: [],
      abort: () => undefined,
    });
    handle.update({ messages: [{ role: 'assistant', content: 'work' }] });
    await handle.finish({ status: 'done', finalContent: 'work' });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.at(-1)?.status).toBe('done');
    expect(seen.at(-1)?.final).toBe('work');
  });

  it('listSnapshots returns runs in startedAt order', () => {
    const registry = createSubagentRunRegistry();
    registry.start({
      id: 'a',
      agent: FAKE_AGENT,
      task: '1',
      initialMessages: [],
      abort: () => undefined,
    });
    registry.start({
      id: 'b',
      agent: FAKE_AGENT,
      task: '2',
      initialMessages: [],
      abort: () => undefined,
    });
    const list = registry.listSnapshots();
    expect(list.map((r) => r.runId)).toEqual(['a', 'b']);
  });
});

describe('ApprovalGateway — snapshot surface', () => {
  it('listSnapshots includes pending requests', async () => {
    const gateway = createApprovalGateway();
    // Register a channel so the request doesn't fail closed.
    gateway.registerChannel('test', {
      sendApprovalRequest: async () => undefined,
    });
    void gateway.request({
      agentId: 'arya',
      toolName: 'shell',
      toolArgs: { cmd: 'ls' },
      channelId: 'test',
    });
    // Snapshot is recorded synchronously.
    const list = gateway.listSnapshots();
    expect(list.length).toBe(1);
    expect(list[0]?.status).toBe('pending');
    expect(list[0]?.toolName).toBe('shell');
    expect(list[0]?.toolArgsPretty).toContain('cmd');
  });

  it('emits on resolve', async () => {
    const gateway = createApprovalGateway();
    gateway.registerChannel('test', {
      sendApprovalRequest: async () => undefined,
    });
    const seen: string[] = [];
    gateway.subscribeAllSnapshots((s) => seen.push(s.status));
    const pendingPromise = gateway.request({
      agentId: 'arya',
      toolName: 'shell',
      toolArgs: {},
      channelId: 'test',
    });
    const token = gateway.listSnapshots()[0]?.approvalId;
    expect(token).toBeDefined();
    gateway.approve(token ?? '');
    await pendingPromise;
    expect(seen).toContain('pending');
    expect(seen).toContain('approved');
  });

  it('toolArgsPretty is precomputed', async () => {
    const gateway = createApprovalGateway();
    gateway.registerChannel('test', {
      sendApprovalRequest: async () => undefined,
    });
    void gateway.request({
      agentId: 'arya',
      toolName: 'write',
      toolArgs: { path: '/tmp/x.txt', content: 'hello' },
      channelId: 'test',
    });
    const snap = gateway.listSnapshots()[0];
    expect(snap?.toolArgsPretty).toContain('"path"');
    expect(snap?.toolArgsPretty).toContain('/tmp/x.txt');
  });
});
