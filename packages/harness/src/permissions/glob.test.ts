import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { compileGlob, matchArgs, matchTool } from './glob';

describe('compileGlob', () => {
  it('matches literal strings exactly', () => {
    expect(compileGlob('git status').test('git status')).toBe(true);
    expect(compileGlob('git status').test('git statuses')).toBe(false);
    expect(compileGlob('git status').test('git')).toBe(false);
  });

  it('treats * as zero-or-more of any character', () => {
    expect(compileGlob('git *').test('git status')).toBe(true);
    expect(compileGlob('git *').test('git')).toBe(false);
    expect(compileGlob('git *').test('git diff HEAD~1')).toBe(true);
  });

  it('treats ? as exactly one character', () => {
    expect(compileGlob('?s').test('ls')).toBe(true);
    expect(compileGlob('?s').test('ks')).toBe(true);
    expect(compileGlob('?s').test('lss')).toBe(false);
  });

  it('escapes regex metacharacters in the rest of the pattern', () => {
    expect(compileGlob('a.b').test('a.b')).toBe(true);
    expect(compileGlob('a.b').test('axb')).toBe(false);
  });

  it('does not let * span newlines (prevents newline-injection bypass)', () => {
    expect(compileGlob('*"command":"ls *').test('{"command":"ls -la"}')).toBe(
      true,
    );
    expect(
      compileGlob('*"command":"ls *').test('{"command":"ls\nrm -rf ~"}'),
    ).toBe(false);
  });
});

describe('matchTool', () => {
  it('matches by exact name', () => {
    expect(matchTool('Bash', 'Bash')).toBe(true);
    expect(matchTool('Bash', 'Read')).toBe(false);
  });

  it('matches anything when the rule tool is "*"', () => {
    expect(matchTool('*', 'Bash')).toBe(true);
    expect(matchTool('*', 'AnyToolName')).toBe(true);
  });
});

describe('matchArgs', () => {
  it('returns true when no pattern is supplied', () => {
    expect(matchArgs(undefined, '{"command":"anything"}')).toBe(true);
  });

  it('matches against the raw args string when a pattern is supplied', () => {
    expect(matchArgs('*"ls *', '{"command":"ls /tmp"}')).toBe(true);
    expect(matchArgs('*"rm *', '{"command":"ls /tmp"}')).toBe(false);
  });
});
