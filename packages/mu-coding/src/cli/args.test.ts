import { describe, expect, it } from 'bun:test';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('defaults to chat with no args', () => {
    expect(parseArgs([])).toEqual({ subcommand: 'chat', args: [] });
  });

  it('recognises --session', () => {
    expect(parseArgs(['--session', 'abc'])).toEqual({
      subcommand: 'chat',
      sessionId: 'abc',
      args: [],
    });
  });

  it('recognises -m / --model', () => {
    expect(parseArgs(['-m', 'gpt-4'])).toEqual({
      subcommand: 'chat',
      model: 'gpt-4',
      args: [],
    });
    expect(parseArgs(['--model', 'llama3'])).toEqual({
      subcommand: 'chat',
      model: 'llama3',
      args: [],
    });
  });

  it('dispatches install/update/outdated/ping/help', () => {
    expect(parseArgs(['install', 'npm:foo'])).toEqual({
      subcommand: 'install',
      args: ['npm:foo'],
    });
    expect(parseArgs(['update'])).toEqual({ subcommand: 'update', args: [] });
    expect(parseArgs(['outdated'])).toEqual({ subcommand: 'outdated', args: [] });
    expect(parseArgs(['ping'])).toEqual({ subcommand: 'ping', args: [] });
    expect(parseArgs(['help'])).toEqual({ subcommand: 'help', args: [] });
  });

  it('treats --help / -h as help subcommand', () => {
    expect(parseArgs(['--help']).subcommand).toBe('help');
    expect(parseArgs(['-h']).subcommand).toBe('help');
  });
});
