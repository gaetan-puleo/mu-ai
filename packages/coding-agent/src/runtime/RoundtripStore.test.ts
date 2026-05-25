import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import type { LLMResponseContext } from 'mu-core';
import { RoundtripStore } from './RoundtripStore';

function buildContext(extras: Record<string, unknown>): LLMResponseContext {
  return extras as LLMResponseContext;
}

describe('RoundtripStore.record', () => {
  it('prefers usage.promptTokens over localContext.usedTokens', () => {
    const store = new RoundtripStore();
    const round = store.record(buildContext({
      usage: { promptTokens: 1234, completionTokens: 56, totalTokens: 1290 },
      localContext: { usedTokens: 9999 },
    }));
    expect(round.usedTokens).toBe(1234);
    expect(round.completionTokens).toBe(56);
    expect(round.totalTokens).toBe(1290);
  });

  it('falls back to localContext.usedTokens when usage is missing', () => {
    const store = new RoundtripStore();
    const round = store.record(buildContext({
      localContext: { usedTokens: 800 },
    }));
    expect(round.usedTokens).toBe(800);
  });

  it('reads windowTokens from props.n_ctx first, then currentSlot.n_ctx, then localContext', () => {
    const store = new RoundtripStore();
    const fromProps = store.record(buildContext({
      props: { n_ctx: 32000 },
      currentSlot: { n_ctx: 16000 },
      localContext: { windowTokens: 4096 },
    }));
    expect(fromProps.windowTokens).toBe(32000);

    const fromSlot = store.record(buildContext({
      currentSlot: { n_ctx: 16000 },
      localContext: { windowTokens: 4096 },
    }));
    expect(fromSlot.windowTokens).toBe(16000);

    const fromLocal = store.record(buildContext({
      localContext: { windowTokens: 4096 },
    }));
    expect(fromLocal.windowTokens).toBe(4096);
  });

  it('marks estimated true when parts come without authoritative usedTokens', () => {
    const store = new RoundtripStore();
    const round = store.record(buildContext({
      localContext: {
        parts: [{ kind: 'system', label: 'system', tokens: 100, estimated: true }],
      },
    }));
    expect(round.estimated).toBe(true);
  });

  it('respects an explicit estimated flag from the provider', () => {
    const store = new RoundtripStore();
    const round = store.record(buildContext({
      usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 },
      localContext: { estimated: true, parts: [] },
    }));
    expect(round.estimated).toBe(true);
  });

  it('leaves windowTokens undefined when the backend does not report it', () => {
    const store = new RoundtripStore();
    const round = store.record(buildContext({
      usage: { promptTokens: 500, completionTokens: 0, totalTokens: 500 },
    }));
    expect(round.windowTokens).toBeUndefined();
  });

  it('assigns increasing 1-based indices', () => {
    const store = new RoundtripStore();
    const first = store.record(buildContext({ usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }));
    const second = store.record(buildContext({ usage: { promptTokens: 2, completionTokens: 0, totalTokens: 2 } }));
    expect(first.index).toBe(1);
    expect(second.index).toBe(2);
    expect(store.all().length).toBe(2);
    expect(store.latest()?.index).toBe(2);
  });

  it('clear() empties history without affecting future indices', () => {
    const store = new RoundtripStore();
    store.record(buildContext({ usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }));
    store.clear();
    expect(store.latest()).toBeUndefined();
    const next = store.record(buildContext({ usage: { promptTokens: 2, completionTokens: 0, totalTokens: 2 } }));
    expect(next.index).toBe(1);
  });

  it('notifies subscribers with the latest roundtrip and full history', () => {
    const store = new RoundtripStore();
    const calls: Array<{ latest: number; size: number }> = [];
    const unsubscribe = store.subscribe((latest, history) => {
      calls.push({ latest: latest.index, size: history.length });
    });
    store.record(buildContext({ usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }));
    store.record(buildContext({ usage: { promptTokens: 2, completionTokens: 0, totalTokens: 2 } }));
    unsubscribe();
    store.record(buildContext({ usage: { promptTokens: 3, completionTokens: 0, totalTokens: 3 } }));
    expect(calls).toEqual([{ latest: 1, size: 1 }, { latest: 2, size: 2 }]);
  });
});
