import { describe, expect, it } from 'bun:test';
import type { ChatMessage } from 'mu-core';
import { PluginRegistry } from 'mu-core';
import { enrichMessageAuthor, resolveAgentInfo } from './handle';

function bareRegistry(): PluginRegistry {
  return new PluginRegistry({ cwd: '/', config: {} });
}

describe('enrichMessageAuthor', () => {
  it('returns the message unchanged when meta.agent is missing', () => {
    const reg = bareRegistry();
    const msg: ChatMessage = { role: 'user', content: 'hi' };
    const enriched = enrichMessageAuthor(msg, reg);
    expect(enriched).toBe(msg); // same reference
    expect('author' in enriched).toBe(false);
  });

  it('stamps a bare-id author when mu-agents is absent', () => {
    const reg = bareRegistry();
    const msg: ChatMessage = {
      role: 'user',
      content: 'hi',
      meta: { agent: 'ghost' },
    };
    const enriched = enrichMessageAuthor(msg, reg);
    expect(enriched.author).toEqual({ id: 'ghost' });
  });

  it('stamps a bare-id author when the agent name is unknown', () => {
    const reg = bareRegistry();
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'x',
      meta: { agent: 'review' },
    };
    const enriched = enrichMessageAuthor(msg, reg);
    expect(enriched.author).toEqual({ id: 'review' });
  });
});

describe('resolveAgentInfo', () => {
  it('returns undefined for empty name', () => {
    const reg = bareRegistry();
    expect(resolveAgentInfo(reg, '')).toBeUndefined();
  });

  it('returns undefined when mu-agents is absent', () => {
    const reg = bareRegistry();
    expect(resolveAgentInfo(reg, 'arya')).toBeUndefined();
  });
});
