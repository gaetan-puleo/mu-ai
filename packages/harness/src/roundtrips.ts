import type { ContextPart, LLMResponseContext } from 'mu-core';

export interface Roundtrip {
  index: number;
  timestamp: number;
  model?: string;
  usedTokens?: number;
  windowTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  parts: ContextPart[];
  estimated: boolean;
  raw: LLMResponseContext;
}

export type RoundtripListener = (latest: Roundtrip, history: readonly Roundtrip[]) => void;

export class RoundtripStore {
  private history: Roundtrip[] = [];
  private listeners = new Set<RoundtripListener>();

  record(context: LLMResponseContext, model?: string): Roundtrip {
    const roundtrip = normalize(context, this.history.length + 1, model);
    this.history.push(roundtrip);
    for (const listener of this.listeners) listener(roundtrip, this.history);
    return roundtrip;
  }

  latest(): Roundtrip | undefined {
    return this.history[this.history.length - 1];
  }

  all(): readonly Roundtrip[] {
    return this.history;
  }

  clear(): void {
    this.history = [];
  }

  subscribe(listener: RoundtripListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function normalize(context: LLMResponseContext, index: number, fallbackModel?: string): Roundtrip {
  const usage = context.usage;
  const map = context.contextMap;

  const usedTokens = usage?.promptTokens ?? map?.usedTokens;
  const windowTokens = map?.windowTokens;
  const parts = map?.parts ?? [];
  const estimated = Boolean(map?.estimated) || (parts.length > 0 && usage?.promptTokens === undefined);
  const model = map?.model ?? fallbackModel;

  return {
    index,
    timestamp: Date.now(),
    model,
    usedTokens,
    windowTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    parts,
    estimated,
    raw: context,
  };
}
