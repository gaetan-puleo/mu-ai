import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillMarkdown, renderSkillBody, splitArgs } from './parser';

describe('parseSkillMarkdown', () => {
  it('parses frontmatter + body', () => {
    const raw = `---
name: hello
description: Says hi
---

Hello $0!
`;
    const parsed = parseSkillMarkdown(raw, 'fallback');
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('hello');
    expect(parsed?.description).toBe('Says hi');
    expect(parsed?.body).toBe('Hello $0!');
  });

  it('falls back to directory name when frontmatter omits `name`', () => {
    const raw = '---\ndescription: x\n---\n\nbody';
    const parsed = parseSkillMarkdown(raw, 'fallback');
    expect(parsed?.name).toBe('fallback');
  });

  it('accepts files with no frontmatter', () => {
    const parsed = parseSkillMarkdown('just a body', 'no-fm');
    expect(parsed?.name).toBe('no-fm');
    expect(parsed?.description).toBe('');
    expect(parsed?.body).toBe('just a body');
  });

  it('rejects malformed YAML', () => {
    const raw = '---\nname: [unbalanced\n---\n\nbody';
    expect(parseSkillMarkdown(raw, 'x')).toBeNull();
  });
});

describe('splitArgs', () => {
  it('splits whitespace-separated tokens', () => {
    expect(splitArgs('a b  c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps quoted strings intact', () => {
    expect(splitArgs('a "hello world" c')).toEqual(['a', 'hello world', 'c']);
  });

  it('supports single quotes', () => {
    expect(splitArgs("'a b' 'c'")).toEqual(['a b', 'c']);
  });

  it('handles backslash escapes inside double quotes', () => {
    expect(splitArgs('"a\\"b"')).toEqual(['a"b']);
  });

  it('returns empty array for empty input', () => {
    expect(splitArgs('')).toEqual([]);
  });
});

describe('renderSkillBody', () => {
  it('substitutes $ARGUMENTS with the raw string', () => {
    const out = renderSkillBody('Fix $ARGUMENTS now', { args: '123', cwd: '/tmp', shell: false });
    expect(out).toBe('Fix 123 now');
  });

  it('substitutes $0 / $1 positionally', () => {
    const out = renderSkillBody('Migrate $0 from $1 to $2', {
      args: 'SearchBar React Vue',
      cwd: '/tmp',
      shell: false,
    });
    expect(out).toBe('Migrate SearchBar from React to Vue');
  });

  it('appends ARGUMENTS line when body has no placeholder', () => {
    const out = renderSkillBody('Body', { args: 'extra', cwd: '/tmp', shell: false });
    expect(out).toBe('Body\n\nARGUMENTS: extra');
  });

  it('runs `!`cmd`` shell injection when enabled', () => {
    // Use a portable shell builtin (echo) so the test runs everywhere.
    const dir = mkdtempSync(join(tmpdir(), 'mu-skill-runner-'));
    writeFileSync(join(dir, 'sentinel.txt'), 'hi');
    const out = renderSkillBody('Result: !`echo from-shell`', {
      args: '',
      cwd: dir,
      shell: true,
    });
    expect(out).toContain('Result: from-shell');
  });

  it('replaces failed shell injections with an [error: ...] placeholder', () => {
    const out = renderSkillBody('X !`bash -c "exit 1"` Y', {
      args: '',
      cwd: '/tmp',
      shell: true,
    });
    expect(out).toMatch(/X \[error: .*\] Y/);
  });
});
