import type { LLMResponseContext } from 'mu-core';

export type RoundtripPartKind =
  | 'system'
  | 'tools'
  | 'messages'
  | 'tool_results'
  | 'skills'
  | 'mcp'
  | 'other';

export interface RoundtripPart {
  kind: RoundtripPartKind;
  label: string;
  tokens: number;
}

export interface Roundtrip {
  index: number;
  timestamp: number;
  model?: string;
  usedTokens?: number;
  windowTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  parts: RoundtripPart[];
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
  const ext = context as Record<string, unknown>;
  const usage = context.usage;
  const props = readObject(ext.props);
  const currentSlot = readObject(ext.currentSlot);
  const localContext = readObject(ext.localContext);

  const usedFromUsage = usage?.promptTokens;
  const usedFromLocal = readNumber(localContext?.usedTokens);
  const usedTokens = usedFromUsage ?? usedFromLocal;

  const windowTokens = readNumber(props?.n_ctx) ??
    readNumber(currentSlot?.n_ctx) ??
    readNumber(localContext?.windowTokens);

  const parts = readParts(localContext?.parts);
  const estimated = Boolean(localContext?.estimated) || (parts.length > 0 && usedFromUsage === undefined);
  const model = readString(localContext?.model) ?? fallbackModel;

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

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readParts(value: unknown): RoundtripPart[] {
  if (!Array.isArray(value)) return [];
  const out: RoundtripPart[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const kind = readString(record.kind) as RoundtripPartKind | undefined;
    const tokens = readNumber(record.tokens);
    if (!kind || tokens === undefined) continue;
    out.push({
      kind,
      label: readString(record.label) ?? kind,
      tokens,
    });
  }
  return out;
}
