import { describe, expect, it } from 'bun:test';
import type { Provider } from './adapter';
import { createProviderRegistry } from './registry';

function fakeProvider(id: string): Provider {
  return {
    id,
    async *streamChat() {
      /* no chunks */
    },
    async listModels() {
      return [];
    },
  };
}

describe('ProviderRegistry', () => {
  it('register / get / list', () => {
    const r = createProviderRegistry();
    r.register(fakeProvider('openai'));
    expect(r.get('openai')?.id).toBe('openai');
    expect(r.list()).toHaveLength(1);
  });

  it('rejects duplicate ids', () => {
    const r = createProviderRegistry();
    r.register(fakeProvider('openai'));
    expect(() => r.register(fakeProvider('openai'))).toThrow();
  });

  it('unregister callback removes', () => {
    const r = createProviderRegistry();
    const off = r.register(fakeProvider('a'));
    off();
    expect(r.get('a')).toBeUndefined();
  });
});
