import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { isCommandLine, parseCommandLine } from './parser';

describe('parseCommandLine', () => {
  it('parses a bare command', () => {
    expect(parseCommandLine('/new')).toEqual({ name: 'new', args: '' });
  });

  it('parses a command with args', () => {
    expect(parseCommandLine('/model gpt-4')).toEqual({ name: 'model', args: 'gpt-4' });
  });

  it('preserves multi-word args verbatim (trimmed)', () => {
    expect(parseCommandLine('/context-export  ./out/path.json  ')).toEqual({
      name: 'context-export',
      args: './out/path.json',
    });
  });

  it('returns undefined when input is not a command', () => {
    expect(parseCommandLine('hello')).toBeUndefined();
    expect(parseCommandLine('')).toBeUndefined();
    expect(parseCommandLine(' / ')).toBeUndefined();
    expect(parseCommandLine('/')).toBeUndefined();
  });

  it('returns undefined when the slash is followed by whitespace or a non-name char', () => {
    expect(parseCommandLine('/ command')).toBeUndefined();
    expect(parseCommandLine('/1bad')).toBeUndefined();
  });

  it('tolerates surrounding whitespace on the whole input', () => {
    expect(parseCommandLine('  /quit  ')).toEqual({ name: 'quit', args: '' });
  });
});

describe('isCommandLine', () => {
  it('is true for valid commands', () => {
    expect(isCommandLine('/new')).toBe(true);
    expect(isCommandLine('/model gpt-4')).toBe(true);
  });
  it('is false for non-commands', () => {
    expect(isCommandLine('hello')).toBe(false);
    expect(isCommandLine('')).toBe(false);
  });
});
