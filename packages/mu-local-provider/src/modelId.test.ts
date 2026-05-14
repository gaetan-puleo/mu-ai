import { describe, expect, it } from 'bun:test';
import { bareModelId, formatModelId, parseModelId, PROVIDER_PREFIX } from './modelId';

describe('parseModelId', () => {
  it('one-segment input → bare id, no kind', () => {
    expect(parseModelId('qwen-3.6-35b')).toEqual({
      provider: PROVIDER_PREFIX,
      id: 'qwen-3.6-35b',
    });
  });

  it('two-segment input with a known kind → kind-qualified', () => {
    expect(parseModelId('llama-swap/qwen-3.6-35b')).toEqual({
      provider: PROVIDER_PREFIX,
      kind: 'llama-swap',
      id: 'qwen-3.6-35b',
    });
    expect(parseModelId('llama-cpp/Qwen3.6-35B-A3B.gguf')).toEqual({
      provider: PROVIDER_PREFIX,
      kind: 'llama-cpp',
      id: 'Qwen3.6-35B-A3B.gguf',
    });
  });

  it('two-segment input with an unknown prefix → treated as bare id', () => {
    expect(parseModelId('vendor/model-x')).toEqual({
      provider: PROVIDER_PREFIX,
      id: 'vendor/model-x',
    });
  });

  it('fully-qualified input → all three segments', () => {
    expect(parseModelId('local/llama-swap/qwen-3.6-35b')).toEqual({
      provider: PROVIDER_PREFIX,
      kind: 'llama-swap',
      id: 'qwen-3.6-35b',
    });
  });

  it('fully-qualified with extra segments → keeps them in the id', () => {
    expect(parseModelId('local/llama-cpp/path/to/model.gguf')).toEqual({
      provider: PROVIDER_PREFIX,
      kind: 'llama-cpp',
      id: 'path/to/model.gguf',
    });
  });

  it('local/<unknown-kind>/... is treated as a bare id (not silently coerced)', () => {
    expect(parseModelId('local/weirdo/model-x')).toEqual({
      provider: PROVIDER_PREFIX,
      id: 'local/weirdo/model-x',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseModelId('  qwen-3.6-35b  ')).toEqual({
      provider: PROVIDER_PREFIX,
      id: 'qwen-3.6-35b',
    });
  });

  it('empty input → empty id, no kind', () => {
    expect(parseModelId('')).toEqual({ provider: PROVIDER_PREFIX, id: '' });
    expect(parseModelId('   ')).toEqual({ provider: PROVIDER_PREFIX, id: '' });
  });
});

describe('formatModelId', () => {
  it('canonicalises a parsed id', () => {
    expect(formatModelId({ kind: 'llama-swap', id: 'qwen-3.6-35b' })).toBe(
      'local/llama-swap/qwen-3.6-35b',
    );
  });
  it('falls back to unknown when kind is missing', () => {
    expect(formatModelId({ id: 'qwen-3.6-35b' })).toBe('local/unknown/qwen-3.6-35b');
  });
  it('round-trips canonical input', () => {
    const a = 'local/llama-swap/qwen-3.6-35b';
    expect(formatModelId(parseModelId(a))).toBe(a);
  });
});

describe('bareModelId', () => {
  it('extracts the trailing id from each input form', () => {
    expect(bareModelId('qwen-3.6-35b')).toBe('qwen-3.6-35b');
    expect(bareModelId('llama-swap/qwen-3.6-35b')).toBe('qwen-3.6-35b');
    expect(bareModelId('local/llama-swap/qwen-3.6-35b')).toBe('qwen-3.6-35b');
    expect(bareModelId('local/llama-cpp/path/to/model.gguf')).toBe('path/to/model.gguf');
  });
});
