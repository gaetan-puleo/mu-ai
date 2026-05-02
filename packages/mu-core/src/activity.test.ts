import { describe, expect, it } from 'bun:test';
import { createActivityBus } from './activity';

describe('ActivityBus', () => {
  it('emits events to multiple subscribers', () => {
    const bus = createActivityBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((e) => a.push(e.summary));
    bus.subscribe((e) => b.push(e.summary));
    bus.emit('tool_start', 'bash', 'running git status');
    expect(a).toEqual(['running git status']);
    expect(b).toEqual(['running git status']);
  });

  it('unsubscribes', () => {
    const bus = createActivityBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.summary));
    bus.emit('tool_start', 'bash', 'first');
    off();
    bus.emit('tool_start', 'bash', 'second');
    expect(seen).toEqual(['first']);
  });

  it('subagent stream is independent', () => {
    const bus = createActivityBus();
    const sub: string[] = [];
    bus.subscribeSubAgent((e) => sub.push(e.kind));
    bus.emitSubAgent({ runId: 'r1', agentId: 'review', kind: 'invocation_start', ts: 1, data: {} });
    expect(sub).toEqual(['invocation_start']);
  });

  it('throwing listener does not break the bus', () => {
    const bus = createActivityBus();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.summary));
    bus.emit('tool_end', 'bash', 'ok');
    expect(seen).toEqual(['ok']);
  });
});
