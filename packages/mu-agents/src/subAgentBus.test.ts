import { describe, expect, it } from 'bun:test';
import { createSubAgentBus, type SubAgentEvent } from './subAgentBus';

function event(kind: SubAgentEvent['kind'], runId = 'r1'): SubAgentEvent {
  return { runId, agentId: 'review', kind, ts: 1, data: {} };
}

describe('SubAgentBus', () => {
  it('emits events to multiple subscribers', () => {
    const bus = createSubAgentBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((e) => a.push(e.kind));
    bus.subscribe((e) => b.push(e.kind));
    bus.emit(event('invocation_start'));
    expect(a).toEqual(['invocation_start']);
    expect(b).toEqual(['invocation_start']);
  });

  it('unsubscribes', () => {
    const bus = createSubAgentBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.kind));
    bus.emit(event('invocation_start'));
    off();
    bus.emit(event('invocation_end'));
    expect(seen).toEqual(['invocation_start']);
  });

  it('throwing listener does not break the bus', () => {
    const bus = createSubAgentBus();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.kind));
    bus.emit(event('tool_call_start'));
    expect(seen).toEqual(['tool_call_start']);
  });
});
