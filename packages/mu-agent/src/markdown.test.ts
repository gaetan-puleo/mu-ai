import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PRIMARY_AGENTS, DEFAULT_SUB_AGENTS } from './builtin';
import { loadAgentFile, loadAgentsFromDir, mergeAgents } from './markdown';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mu-agent-md-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function write(path: string, content: string): string {
  const full = join(tmp, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  return full;
}

describe('loadAgentFile', () => {
  it('parses frontmatter + body', () => {
    const path = write(
      'a.md',
      `---
name: foo
description: A test
agent: primary
tools: read_file, bash
color: "#ff0000"
---

The body.`,
    );
    const def = loadAgentFile(path, 'a');
    expect(def).not.toBeNull();
    expect(def?.name).toBe('foo');
    expect(def?.description).toBe('A test');
    expect(def?.tools).toEqual(['read_file', 'bash']);
    expect(def?.color).toBe('#ff0000');
    expect(def?.systemPrompt).toBe('The body.');
    expect(def?.type).toBe('primary');
  });

  it('coerces unknown agent type to primary', () => {
    const path = write('b.md', '---\nname: x\nagent: weird\ntools:\n---\n\nbody');
    expect(loadAgentFile(path, 'b')?.type).toBe('primary');
  });

  it('treats `agent: subagent` as subagent', () => {
    const path = write('c.md', '---\nname: x\nagent: subagent\n---\n\nbody');
    expect(loadAgentFile(path, 'c')?.type).toBe('subagent');
  });

  it('returns null for missing file', () => {
    expect(loadAgentFile(join(tmp, 'nope.md'), 'nope')).toBeNull();
  });

  it('returns null for missing frontmatter', () => {
    const path = write('plain.md', 'no frontmatter here');
    expect(loadAgentFile(path, 'plain')).toBeNull();
  });

  it('falls back to filename for missing name', () => {
    const path = write('no-name.md', '---\ndescription: x\n---\n\nbody');
    expect(loadAgentFile(path, 'fallback')?.name).toBe('fallback');
  });
});

describe('loadAgentsFromDir', () => {
  it('skips non-md files and bad files', () => {
    write('good.md', '---\nname: g\n---\n\nbody');
    write('bad.md', 'no frontmatter');
    write('readme.txt', 'ignored');
    const list = loadAgentsFromDir(tmp);
    expect(list.map((a) => a.name)).toEqual(['g']);
  });

  it('returns [] for missing directory', () => {
    expect(loadAgentsFromDir(join(tmp, 'missing'))).toEqual([]);
  });
});

describe('mergeAgents', () => {
  it('overrides defaults by name + type', () => {
    const merged = mergeAgents(DEFAULT_PRIMARY_AGENTS, [
      {
        name: 'build',
        description: 'overridden',
        tools: ['read_file'],
        systemPrompt: 'Custom build',
        type: 'primary',
      },
    ]);
    const build = merged.primary.find((a) => a.name === 'build');
    expect(build?.description).toBe('overridden');
    expect(merged.primary.find((a) => a.name === 'plan')).toBeDefined();
  });

  it('keeps subagent + primary namespaces separate', () => {
    const merged = mergeAgents(
      [...DEFAULT_PRIMARY_AGENTS, ...DEFAULT_SUB_AGENTS],
      [
        {
          name: 'build',
          description: 'as subagent',
          tools: ['read_file'],
          systemPrompt: 'sub',
          type: 'subagent',
        },
      ],
    );
    expect(merged.primary.some((a) => a.name === 'build')).toBe(true);
    expect(merged.subagent.some((a) => a.name === 'build' && a.description === 'as subagent')).toBe(true);
  });
});
