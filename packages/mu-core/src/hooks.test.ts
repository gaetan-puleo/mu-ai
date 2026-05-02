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

  it('propagates continue to the caller', async () => {
    // Regression: the composer used to silently drop `continue`, falling
    // back to `pass`. That made the host re-push the user message on top
    // of the one a plugin (mu-agents @-mention dispatch) had already
    // appended, producing a duplicate user bubble in the transcript.
    const hooks: LifecycleHooks[] = [{ transformUserInput: () => ({ kind: 'continue' }) }];
    const result = await runTransformUserInputHooks(hooks, 'X');
    expect(result.kind).toBe('continue');
  });

  it('continue short-circuits the chain', async () => {
    // Once a plugin has appended the user message itself, downstream
    // hooks can't safely transform absent text — same chain-termination
    // semantics as `intercept`.
    let secondCalled = false;
    const hooks: LifecycleHooks[] = [
      { transformUserInput: () => ({ kind: 'continue' }) },
      {
        transformUserInput: () => {
          secondCalled = true;
          return { kind: 'transform', text: 'should-not-apply' };
        },
      },
    ];
    const result = await runTransformUserInputHooks(hooks, 'X');
    expect(result.kind).toBe('continue');
    expect(secondCalled).toBe(false);
  });
});
