import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createMentionEngine } from './engine';
import type { MentionResolver } from './types';

const fileResolver: MentionResolver = {
  prefix: 'file',
  resolve(target) {
    return { display: `[file:${target}]`, payload: { path: target } };
  },
};

describe('createMentionEngine', () => {
  it('resolves a single mention and replaces the display text', async () => {
    const engine = createMentionEngine();
    engine.register(fileResolver);
    const { text, mentions } = await engine.expand('see @file:./foo.ts now');
    expect(text).toBe('see [file:./foo.ts] now');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].prefix).toBe('file');
    expect(mentions[0].target).toBe('./foo.ts');
  });

  it('handles multiple mentions in order', async () => {
    const engine = createMentionEngine();
    engine.register(fileResolver);
    engine.register({
      prefix: 'agent',
      resolve(target) {
        return { display: `<@${target}>` };
      },
    });
    const { text, mentions } = await engine.expand('@file:a.ts and @agent:explorer');
    expect(text).toBe('[file:a.ts] and <@explorer>');
    expect(mentions.map((m) => m.prefix)).toEqual(['file', 'agent']);
  });

  it('ignores unknown prefixes', async () => {
    const engine = createMentionEngine();
    engine.register(fileResolver);
    const { text, mentions } = await engine.expand('@unknown:x');
    expect(text).toBe('@unknown:x');
    expect(mentions).toHaveLength(0);
  });

  it('keeps raw text when resolver returns no display', async () => {
    const engine = createMentionEngine();
    engine.register({
      prefix: 'skill',
      resolve() {
        return { payload: { extra: true } };
      },
    });
    const { text, mentions } = await engine.expand('use @skill:run');
    expect(text).toBe('use @skill:run');
    expect(mentions).toHaveLength(1);
  });

  it('throws on duplicate registrations', () => {
    const engine = createMentionEngine();
    engine.register(fileResolver);
    expect(() => engine.register(fileResolver)).toThrow();
  });

  it('does not resolve an escaped mention and strips the backslash', async () => {
    let resolveCalls = 0;
    const engine = createMentionEngine();
    engine.register({
      prefix: 'user',
      resolve(target) {
        resolveCalls++;
        return { display: `<@${target}>` };
      },
    });
    const { text, mentions } = await engine.expand('contact \\@user:alice for help');
    expect(text).toBe('contact @user:alice for help');
    expect(mentions).toHaveLength(0);
    expect(resolveCalls).toBe(0);
  });

  it('does not resolve mentions inside inline code spans', async () => {
    let resolveCalls = 0;
    const engine = createMentionEngine();
    engine.register({
      prefix: 'file',
      resolve(target) {
        resolveCalls++;
        return { display: `[file:${target}]` };
      },
    });
    const { text, mentions } = await engine.expand('see `@file:foo.ts` in the log');
    expect(text).toBe('see `@file:foo.ts` in the log');
    expect(mentions).toHaveLength(0);
    expect(resolveCalls).toBe(0);
  });

  it('does not resolve mentions inside fenced code blocks', async () => {
    let resolveCalls = 0;
    const engine = createMentionEngine();
    engine.register({
      prefix: 'file',
      resolve(target) {
        resolveCalls++;
        return { display: `[file:${target}]` };
      },
    });
    const input = 'before\n```\n@file:foo.ts\n```\nafter';
    const { text, mentions } = await engine.expand(input);
    expect(text).toBe(input);
    expect(mentions).toHaveLength(0);
    expect(resolveCalls).toBe(0);
  });

  it('still resolves mentions outside code regions when both are present', async () => {
    const engine = createMentionEngine();
    engine.register(fileResolver);
    const { text, mentions } = await engine.expand('see `@file:skip.ts` but check @file:./foo.ts');
    expect(text).toBe('see `@file:skip.ts` but check [file:./foo.ts]');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].target).toBe('./foo.ts');
  });
});
