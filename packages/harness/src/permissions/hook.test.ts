import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import type { Tool } from 'mu-core';
import { createPermissionHook } from './hook';
import { createPermissionRegistry } from './registry';

function makeTool(name: string): Tool {
  return {
    name,
    description: 'test',
    parameters: { type: 'object', properties: {} },
    execute: () => 'unused',
    onError: (e: unknown) => String(e),
  };
}

describe('createPermissionHook', () => {
  it('returns undefined when the registry allows', async () => {
    const registry = createPermissionRegistry({
      rules: [{ tool: 'Read', decision: 'allow' }],
      default: 'ask',
    });
    const hook = createPermissionHook({ registry });
    const result = await hook({ tool: makeTool('Read'), args: '{}' });
    expect(result).toBeUndefined();
  });

  it('blocks with a reason when the registry denies', async () => {
    const registry = createPermissionRegistry({
      rules: [{ tool: 'Bash', decision: 'deny' }],
      default: 'allow',
    });
    const hook = createPermissionHook({ registry });
    const result = await hook({ tool: makeTool('Bash'), args: '{}' });
    expect(result).toEqual({ block: true, reason: 'permission denied for Bash (rule: Bash)' });
  });

  it('blocks when ask is returned and no prompt is provided', async () => {
    const registry = createPermissionRegistry({ rules: [], default: 'ask' });
    const hook = createPermissionHook({ registry });
    const result = await hook({ tool: makeTool('Bash'), args: '{}' });
    expect(result).toEqual({
      block: true,
      reason: 'permission required for Bash (no prompt handler configured)',
    });
  });

  it('delegates to prompt when ask, and proceeds on allow', async () => {
    const registry = createPermissionRegistry({ rules: [], default: 'ask' });
    let asked = 0;
    const hook = createPermissionHook({
      registry,
      prompt: async () => {
        asked++;
        return 'allow';
      },
    });
    const result = await hook({ tool: makeTool('Bash'), args: '{"command":"ls"}' });
    expect(asked).toBe(1);
    expect(result).toBeUndefined();
  });

  it('delegates to prompt when ask, and blocks on user deny', async () => {
    const registry = createPermissionRegistry({ rules: [], default: 'ask' });
    const hook = createPermissionHook({
      registry,
      prompt: async () => 'deny',
    });
    const result = await hook({ tool: makeTool('Bash'), args: '{}' });
    expect(result).toEqual({ block: true, reason: 'user denied Bash' });
  });

  it('passes the matched rule to the prompt when one matched', async () => {
    const askRule = { tool: 'Bash', argsPattern: '*"command":"git*', decision: 'ask' as const };
    const registry = createPermissionRegistry({
      rules: [askRule],
      default: 'allow',
    });
    let seenMatched: unknown;
    const hook = createPermissionHook({
      registry,
      prompt: async (_, matched) => {
        seenMatched = matched;
        return 'allow';
      },
    });
    await hook({ tool: makeTool('Bash'), args: '{"command":"git status"}' });
    expect(seenMatched).toBe(askRule);
  });
});
