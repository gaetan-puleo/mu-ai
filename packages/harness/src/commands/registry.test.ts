import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createCommandRegistry } from './registry';
import type { Command } from './types';

function dummy(name: string, run: Command['run'] = () => ({ ok: true })): Command {
  return { name, description: name, run };
}

describe('CommandRegistry', () => {
  it('registers and lists commands', () => {
    const reg = createCommandRegistry();
    reg.register(dummy('new'));
    reg.register(dummy('fork'));
    expect(reg.list().map((c) => c.name).sort()).toEqual(['fork', 'new']);
  });

  it('throws on duplicate registration', () => {
    const reg = createCommandRegistry();
    reg.register(dummy('new'));
    expect(() => reg.register(dummy('new'))).toThrow(/already registered/);
  });

  it('resolves aliases', () => {
    const reg = createCommandRegistry();
    reg.register({ ...dummy('new'), aliases: ['n'] });
    expect(reg.get('n')?.name).toBe('new');
  });

  it('parses "/foo arg1 arg2" into args (default whitespace split)', () => {
    const reg = createCommandRegistry();
    reg.register(dummy('fork'));
    const parsed = reg.parse('/fork 5 abc');
    expect(parsed?.command.name).toBe('fork');
    expect(parsed?.args).toEqual(['5', 'abc']);
    expect(parsed?.rawArgs).toBe('5 abc');
  });

  it('uses custom parseArgs when provided', () => {
    const reg = createCommandRegistry();
    reg.register({
      ...dummy('fork'),
      parseArgs: (raw) => ({ index: Number(raw) }),
    });
    const parsed = reg.parse('/fork 5');
    expect(parsed?.args).toEqual({ index: 5 });
  });

  it('returns undefined for non-slash input', () => {
    const reg = createCommandRegistry();
    expect(reg.parse('hello there')).toBeUndefined();
  });

  it('returns undefined for unknown commands', () => {
    const reg = createCommandRegistry();
    expect(reg.parse('/never-registered')).toBeUndefined();
  });

  it('runs the command and forwards args + ctx', async () => {
    const reg = createCommandRegistry();
    let seenArgs: unknown;
    let seenCtx: unknown;
    reg.register({
      ...dummy('echo'),
      run: (args, ctx) => {
        seenArgs = args;
        seenCtx = ctx;
        return { ok: true };
      },
    });
    const result = await reg.run('/echo hi there', { user: 'alice' });
    expect(result.ok).toBe(true);
    expect(seenArgs).toEqual(['hi', 'there']);
    expect(seenCtx).toEqual({ user: 'alice' });
  });

  it('captures thrown errors into a failed result', async () => {
    const reg = createCommandRegistry();
    reg.register({
      ...dummy('boom'),
      run: () => {
        throw new Error('bad');
      },
    });
    const result = await reg.run('/boom', {});
    expect(result).toEqual({ ok: false, error: 'bad' });
  });

  it('returns an error result for unknown input', async () => {
    const reg = createCommandRegistry();
    const result = await reg.run('not a command', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown command');
  });

  it('throws when a new command name collides with an existing alias', () => {
    const reg = createCommandRegistry();
    reg.register({ ...dummy('a'), aliases: ['b'] });
    expect(() => reg.register(dummy('b'))).toThrow(/collides with an existing alias/);
    // Confirm that the first command remains resolvable via its alias.
    expect(reg.get('b')?.name).toBe('a');
  });

  it('throws when a new alias collides with an existing command name', () => {
    const reg = createCommandRegistry();
    reg.register(dummy('b'));
    expect(() => reg.register({ ...dummy('a'), aliases: ['b'] })).toThrow(/collides with an existing name or alias/);
  });

  it('unregisters a command and clears its aliases', () => {
    const reg = createCommandRegistry();
    reg.register({ ...dummy('new'), aliases: ['n'] });
    reg.unregister('new');
    expect(reg.get('new')).toBeUndefined();
    expect(reg.get('n')).toBeUndefined();
  });
});
