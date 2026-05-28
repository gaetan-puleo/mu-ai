import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { SubAgentRunStore } from './subAgentRun';

describe('SubAgentRunStore', () => {
  it('starts a run with an initial user-line transcript entry', () => {
    const store = new SubAgentRunStore();
    const run = store.start({ id: 'r1', agentName: 'explorer', task: 'find x' });
    expect(run.status).toBe('running');
    expect(run.activity).toBe('starting…');
    expect(run.transcript).toEqual([{ kind: 'user', content: 'find x' }]);
    expect(run.agentColor).toBeUndefined();
  });

  it('lists every started run', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't1' });
    store.start({ id: 'r2', agentName: 'b', task: 't2' });
    expect(store.list().map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('pushes tool calls into the transcript and updates activity', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.pushEvent('r1', {
      type: 'tool_call',
      call: { id: 'c1', name: 'read', args: '{"path":"x"}' },
    });
    const run = store.get('r1')!;
    expect(run.transcript.at(-1)).toEqual({ kind: 'tool_call', tool: 'read', args: '{"path":"x"}' });
    expect(run.activity).toContain('read');
  });

  it('truncates long activity strings to keep them one-line-ish', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.pushEvent('r1', {
      type: 'assistant_message',
      message: { role: 'assistant', content: 'x'.repeat(200) },
    });
    expect(store.get('r1')!.activity.length).toBeLessThanOrEqual(80);
  });

  it('records errors with the message text', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.pushEvent('r1', { type: 'error', error: new Error('boom') });
    const run = store.get('r1')!;
    expect(run.transcript.at(-1)).toEqual({ kind: 'error', message: 'boom' });
    expect(run.activity).toBe('error: boom');
  });

  it('completes a run as ok', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.complete('r1', { content: 'done!' });
    const run = store.get('r1')!;
    expect(run.status).toBe('completed');
    expect(run.result).toBe('done!');
    expect(run.endedAt).toBeDefined();
  });

  it('completes a run as failed with an error message', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.complete('r1', { content: '', error: 'boom' });
    const run = store.get('r1')!;
    expect(run.status).toBe('error');
    expect(run.errorMessage).toBe('boom');
    expect(run.activity).toBe('error: boom');
  });

  it('notifies subscribers on every state change', () => {
    const store = new SubAgentRunStore();
    const seen: string[] = [];
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.subscribe('r1', (run) => seen.push(run.activity));
    store.pushEvent('r1', {
      type: 'assistant_message',
      message: { role: 'assistant', content: 'hi' },
    });
    store.complete('r1', { content: 'final' });
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it('subscribe returns an unsubscribe that stops further notifications', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    let count = 0;
    const off = store.subscribe('r1', () => { count++; });
    store.pushEvent('r1', { type: 'assistant_message', message: { role: 'assistant', content: 'a' } });
    off();
    store.pushEvent('r1', { type: 'assistant_message', message: { role: 'assistant', content: 'b' } });
    expect(count).toBe(1);
  });

  it('ignores re-published user_message events for the initial prompt', () => {
    const store = new SubAgentRunStore();
    store.start({ id: 'r1', agentName: 'a', task: 't' });
    store.pushEvent('r1', { type: 'user_message', message: { role: 'user', content: 't' } });
    const run = store.get('r1')!;
    // Only the initial user entry should be present.
    const userEntries = run.transcript.filter((e) => e.kind === 'user');
    expect(userEntries).toHaveLength(1);
  });
});
