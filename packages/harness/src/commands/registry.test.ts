import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { type Command, createCommandRegistry } from './registry';

const noop: Command<unknown>['run'] = () => {};

describe('CommandRegistry', () => {
  it('registers and lists commands in registration order', () => {
    const r = createCommandRegistry();
    r.register({ name: 'a', description: 'A', run: noop });
    r.register({ name: 'b', description: 'B', run: noop });
    expect(r.list().map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('throws on duplicate registration', () => {
    const r = createCommandRegistry();
    r.register({ name: 'a', description: 'A', run: noop });
    expect(() => r.register({ name: 'a', description: 'A2', run: noop }))
      .toThrow(/already registered/);
  });

  it('unregister removes from both lookup and order', () => {
    const r = createCommandRegistry();
    r.register({ name: 'a', description: 'A', run: noop });
    r.register({ name: 'b', description: 'B', run: noop });
    r.unregister('a');
    expect(r.list().map((c) => c.name)).toEqual(['b']);
    expect(r.get('a')).toBeUndefined();
  });

  it('match returns command + parsed args', () => {
    const r = createCommandRegistry();
    const cmd: Command = { name: 'model', description: 'switch', run: noop };
    r.register(cmd);
    const result = r.match('/model gpt-4');
    expect(result?.command).toBe(cmd);
    expect(result?.args).toBe('gpt-4');
  });

  it('match returns undefined for non-command input', () => {
    const r = createCommandRegistry();
    r.register({ name: 'new', description: '', run: noop });
    expect(r.match('hello')).toBeUndefined();
  });

  it('match returns undefined for an unknown command name', () => {
    const r = createCommandRegistry();
    r.register({ name: 'new', description: '', run: noop });
    expect(r.match('/ghost')).toBeUndefined();
  });

  it('passes the host context object through to run()', async () => {
    const r = createCommandRegistry<{ count: number }>();
    let captured: { count: number } | undefined;
    r.register({
      name: 'tick',
      description: '',
      run: (_args, ctx) => {
        captured = ctx;
      },
    });
    const match = r.match('/tick');
    await match?.command.run(match.args, { count: 7 });
    expect(captured).toEqual({ count: 7 });
  });
});
