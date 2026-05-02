import { describe, expect, it } from 'bun:test';
import { runBeforeToolExecHook, runTransformUserInputHooks } from './hooks';
import type { LifecycleHooks } from './plugin';

const call = { id: '1', function: { name: 'foo', arguments: '{}' } };

describe('runBeforeToolExecHook', () => {
  it('returns the call unchanged when no hook intervenes', async () => {
    const result = await runBeforeToolExecHook([], call);
    expect(result).toEqual(call);
  });

  it('lets later hooks transform the call', async () => {
    const hooks: LifecycleHooks[] = [
      {
        beforeToolExec: (c) => ({ ...c, function: { ...c.function, name: 'bar' } }),
      },
      {
        beforeToolExec: (c) =>
          'blocked' in c ? c : { ...c, function: { ...c.function, name: c.function.name.toUpperCase() } },
      },
    ];
    const result = await runBeforeToolExecHook(hooks, call);
    expect('blocked' in result).toBe(false);
    if (!('blocked' in result)) {
      expect(result.function.name).toBe('BAR');
    }
  });

  it('short-circuits on first block', async () => {
    let secondCalled = false;
    const hooks: LifecycleHooks[] = [
      { beforeToolExec: () => ({ blocked: true, content: 'denied', error: true }) },
      {
        beforeToolExec: (c) => {
          secondCalled = true;
          return c;
        },
      },
    ];
    const result = await runBeforeToolExecHook(hooks, call);
    expect('blocked' in result && result.content).toBe('denied');
    expect(secondCalled).toBe(false);
  });
});

describe('runTransformUserInputHooks', () => {
  it('returns pass when no hook intervenes', async () => {
    expect(await runTransformUserInputHooks([], 'hello')).toEqual({ kind: 'pass' });
  });

  it('threads transformed text through subsequent hooks', async () => {
    const hooks: LifecycleHooks[] = [
      { transformUserInput: (t) => ({ kind: 'transform', text: `[a]${t}` }) },
      { transformUserInput: (t) => ({ kind: 'transform', text: `${t}[b]` }) },
    ];
    const result = await runTransformUserInputHooks(hooks, 'X');
    expect(result.kind === 'transform' && result.text).toBe('[a]X[b]');
  });

  it('intercept short-circuits the chain', async () => {
    let secondCalled = false;
    const hooks: LifecycleHooks[] = [
      { transformUserInput: () => ({ kind: 'intercept' }) },
      {
        transformUserInput: () => {
          secondCalled = true;
          return { kind: 'pass' };
        },
      },
    ];
    const result = await runTransformUserInputHooks(hooks, 'X');
    expect(result.kind).toBe('intercept');
    expect(secondCalled).toBe(false);
  });
});
