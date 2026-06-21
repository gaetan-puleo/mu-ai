import { expect, test } from 'vitest';
import { createCommandRegistry } from './registry';
import type { Command } from './types';

const noop: Command = { name: 'noop', description: 'does nothing', run: () => ({ ok: true }) };

test('registers and runs a command', async () => {
  const registry = createCommandRegistry([noop]);
  const echo: Command = { name: 'echo', description: 'echoes args', run: (args) => ({ ok: true, output: args }) };
  registry.register(echo);
  const result = await registry.run('/echo hello world');
  expect(result).toEqual({ ok: true, output: 'hello world' });
});

test('resolves aliases', async () => {
  const registry = createCommandRegistry();
  registry.register({ name: 'quit', description: 'exit', aliases: ['q'], run: () => ({ ok: true, output: 'bye' }) });
  expect((await registry.run('/q')).output).toBe('bye');
});

test('an unknown command returns an error result', async () => {
  const registry = createCommandRegistry();
  const result = await registry.run('/nope');
  expect(result.ok).toBe(false);
});

test("an input that isn't a command returns an error result", async () => {
  const registry = createCommandRegistry();
  expect((await registry.run('hello')).ok).toBe(false);
});

test('a duplicate registration throws unless override', () => {
  const registry = createCommandRegistry([noop]);
  expect(() => registry.register(noop)).toThrow();
  expect(() => registry.register({ ...noop, description: 'new' }, { override: true })).not.toThrow();
  expect(registry.get('noop')?.description).toBe('new');
});

test('passes the context to the command', async () => {
  const registry = createCommandRegistry();
  registry.register({
    name: 'whoami',
    description: 'session',
    run: (_args, ctx) => ({ ok: true, output: ctx.sessionId }),
  });
  expect((await registry.run('/whoami', { sessionId: 's1' })).output).toBe('s1');
});

test('run surfaces thrown errors as a result', async () => {
  const registry = createCommandRegistry();
  registry.register({
    name: 'boom',
    description: 'throws',
    run: () => {
      throw new Error('kaboom');
    },
  });
  const result = await registry.run('/boom');
  expect(result).toEqual({ ok: false, error: 'kaboom' });
});

test('unregister removes the command and its aliases', async () => {
  const registry = createCommandRegistry();
  registry.register({ name: 'quit', description: 'exit', aliases: ['q'], run: () => ({ ok: true }) });
  registry.unregister('quit');
  expect(registry.get('quit')).toBeUndefined();
  expect((await registry.run('/q')).ok).toBe(false);
});
