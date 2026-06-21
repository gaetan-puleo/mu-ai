import { describe, expect, it } from 'vitest';
import type { AgentSessionEvent } from 'mu-harness';
import type { Message } from 'mu-core';
import { formatToolArgs, Transcript } from './transcript';

const userMsg = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

describe('Transcript', () => {
  it('builds the streamed user + assistant entries from the events', () => {
    const t = new Transcript();
    t.appendUser('hi');
    const events: AgentSessionEvent[] = [
      { type: 'turn_start', input: userMsg('hi') },
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] } },
      { type: 'turn_end' },
    ];
    for (const event of events) t.applyEvent(event);

    expect(t.entries.length).toBe(2);
    expect(t.entries[0]).toEqual({ kind: 'user', text: 'hi' });
    expect(t.entries[1]).toEqual({ kind: 'assistant', text: 'Hello world' });
  });

  it('accumulates streamed reasoning into a reasoning entry before the response', () => {
    const t = new Transcript();
    t.appendUser('hi');
    const events: AgentSessionEvent[] = [
      { type: 'turn_start', input: userMsg('hi') },
      { type: 'reasoning', text: 'Let me ' },
      { type: 'reasoning', text: 'think.' },
      { type: 'text', text: 'Hello' },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } },
      { type: 'turn_end' },
    ];
    for (const event of events) t.applyEvent(event);

    expect(t.entries.map((e) => e.kind)).toEqual(['user', 'reasoning', 'assistant']);
    const reasoning = t.entries[1];
    expect(reasoning.kind === 'reasoning' && reasoning.text).toBe('Let me think.');
  });

  it('records the tool calls but hides the raw tool results in the transcript', () => {
    const t = new Transcript();
    t.appendUser('read it');
    t.applyEvent({ type: 'turn_start', input: userMsg('read it') });
    t.applyEvent({ type: 'tool_call', id: 'c1', name: 'read', input: { path: 'a.ts' } });
    t.applyEvent({
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'read', input: { path: 'a.ts' } }] },
    });
    t.applyEvent({
      type: 'message',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', id: 'c1', content: [{ type: 'text', text: 'line 1\nline 2' }] }],
      },
    });

    const kinds = t.entries.map((e) => e.kind);
    expect(kinds).toEqual(['user', 'tool_call']);
    const call = t.entries[1];
    expect(call.kind === 'tool_call' && call.name).toBe('read');
  });

  it('initializes from an existing message list, ignoring the system message', () => {
    const t = new Transcript();
    t.seed([
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      userMsg('hey'),
      { role: 'assistant', content: [{ type: 'text', text: 'yo' }] },
    ]);
    expect(t.entries).toEqual([
      { kind: 'user', text: 'hey' },
      { kind: 'assistant', text: 'yo' },
    ]);
  });

  it('formats the tool arguments according to the tool', () => {
    expect(formatToolArgs('read', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(formatToolArgs('bash', { cmd: 'ls -la' })).toBe('ls -la');
    expect(formatToolArgs('subagent', { agent: 'reviewer', task: 'x' })).toBe('reviewer');
  });

  it('suppresses the live subagent tool line (the card replaces it)', () => {
    const t = new Transcript();
    t.appendUser('delegate');
    t.applyEvent({ type: 'turn_start', input: userMsg('delegate') });
    t.applyEvent({ type: 'tool_call', id: 'c1', name: 'subagent', input: { agent: 'reviewer', task: 'x' } });
    expect(t.entries.map((e) => e.kind)).toEqual(['user']);
  });

  it('tracks a sub-agent run through its handle (tools, then result)', () => {
    const t = new Transcript();
    const handle = t.appendSubAgent('reviewer');
    const entry = t.entries[0];
    expect(entry.kind === 'subagent' && entry.status).toBe('running');

    handle.addTool('bash ls');
    handle.addTool('read a.ts');
    expect(entry.kind === 'subagent' && entry.tools).toBe(2);
    expect(entry.kind === 'subagent' && entry.activity).toBe('read a.ts');
    expect(entry.kind === 'subagent' && entry.log).toEqual(['bash ls', 'read a.ts']);

    handle.finish('all good');
    expect(entry.kind === 'subagent' && entry.status).toBe('done');
    expect(entry.kind === 'subagent' && entry.result).toBe('all good');
    expect(entry.kind === 'subagent' && entry.activity).toBe('');
  });

  it('marks a failed sub-agent run as an error with its message', () => {
    const t = new Transcript();
    const handle = t.appendSubAgent('reviewer');
    handle.fail('boom');
    const entry = t.entries[0];
    expect(entry.kind === 'subagent' && entry.status).toBe('error');
    expect(entry.kind === 'subagent' && entry.result).toBe('boom');
  });
});
