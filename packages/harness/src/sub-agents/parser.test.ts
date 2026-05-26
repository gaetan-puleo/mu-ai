import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { parseSubAgent } from './parser';

describe('parseSubAgent', () => {
  it('parses a complete sub-agent declaration (array tools)', () => {
    const agent = parseSubAgent({
      source: [
        '---',
        'name: explorer',
        'description: Read-only search agent',
        'tools: [read_file, grep, list_dir]',
        'color: "#ff8c00"',
        '---',
        '',
        'You are the explorer agent. Your job is to find code.',
        '',
      ].join('\n'),
      filePath: '/agents/explorer.md',
      fallbackName: 'fallback',
    });
    expect(agent).toEqual({
      name: 'explorer',
      description: 'Read-only search agent',
      prompt: 'You are the explorer agent. Your job is to find code.',
      tools: ['read_file', 'grep', 'list_dir'],
      permissions: [],
      type: undefined,
      filePath: '/agents/explorer.md',
      color: '#ff8c00',
    });
  });

  it('defaults to all tools when tools is "*" or missing', () => {
    const all = parseSubAgent({
      source: '---\nname: x\ndescription: y\ntools: "*"\n---\nbody',
      filePath: '/x.md',
      fallbackName: 'x',
    });
    expect(all.tools).toEqual(['*']);
    expect(all.permissions).toEqual([]);

    const omitted = parseSubAgent({
      source: '---\nname: x\ndescription: y\n---\nbody',
      filePath: '/x.md',
      fallbackName: 'x',
    });
    expect(omitted.tools).toEqual(['*']);
  });

  it('falls back to filename when name frontmatter is absent', () => {
    const agent = parseSubAgent({
      source: '---\ndescription: y\n---\nbody',
      filePath: '/agents/review.md',
      fallbackName: 'review',
    });
    expect(agent.name).toBe('review');
  });

  it('throws when description is missing', () => {
    expect(() =>
      parseSubAgent({
        source: '---\nname: x\n---\nbody',
        filePath: '/x.md',
        fallbackName: 'x',
      })
    ).toThrow(/missing "description"/);
  });

  it('throws when prompt body is empty', () => {
    expect(() =>
      parseSubAgent({
        source: '---\nname: x\ndescription: y\n---\n',
        filePath: '/x.md',
        fallbackName: 'x',
      })
    ).toThrow(/empty prompt body/);
  });

  it('accepts comma-separated tools as a string fallback', () => {
    const agent = parseSubAgent({
      source: '---\nname: x\ndescription: y\ntools: "a, b ,c"\n---\nbody',
      filePath: '/x.md',
      fallbackName: 'x',
    });
    expect(agent.tools).toEqual(['a', 'b', 'c']);
    expect(agent.permissions).toEqual([]);
  });

  it('extracts per-tool permissions when tools is an object', () => {
    const agent = parseSubAgent({
      source: [
        '---',
        'name: arya',
        'description: primary',
        'type: primary',
        'tools:',
        '  read: allow',
        '  write: ask',
        '  bash:',
        '    "git *": allow',
        '    "**": ask',
        '---',
        'body',
      ].join('\n'),
      filePath: '/arya.md',
      fallbackName: 'arya',
    });
    expect(agent.type).toBe('primary');
    expect(agent.tools).toEqual(['read', 'write', 'bash']);
    expect(agent.permissions).toEqual([
      { tool: 'read', decision: 'allow' },
      { tool: 'write', decision: 'ask' },
      { tool: 'bash', argsPattern: 'git *', decision: 'allow' },
      { tool: 'bash', argsPattern: '**', decision: 'ask' },
    ]);
  });

  it('excludes pure-deny tools from the whitelist (still records the rule)', () => {
    const agent = parseSubAgent({
      source: [
        '---',
        'name: plan',
        'description: read-only',
        'type: primary',
        'tools:',
        '  read: allow',
        '  write: deny',
        '  bash:',
        '    "git *": allow',
        '    "**": deny',
        '  edit:',
        '    "**": deny',
        '---',
        'body',
      ].join('\n'),
      filePath: '/plan.md',
      fallbackName: 'plan',
    });
    // write (string deny) and edit (only deny branches) are excluded.
    // bash has a per-arg allow alongside the deny so it stays exposed.
    expect(agent.tools).toEqual(['read', 'bash']);
    expect(agent.permissions).toEqual([
      { tool: 'read', decision: 'allow' },
      { tool: 'write', decision: 'deny' },
      { tool: 'bash', argsPattern: 'git *', decision: 'allow' },
      { tool: 'bash', argsPattern: '**', decision: 'deny' },
      { tool: 'edit', argsPattern: '**', decision: 'deny' },
    ]);
  });

  it('throws on an invalid decision string', () => {
    expect(() =>
      parseSubAgent({
        source: '---\nname: x\ndescription: y\ntools:\n  read: maybe\n---\nbody',
        filePath: '/x.md',
        fallbackName: 'x',
      })
    ).toThrow(/invalid decision/);
  });
});
