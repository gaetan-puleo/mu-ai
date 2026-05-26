import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createPermissionRegistry } from './registry';

describe('createPermissionRegistry', () => {
  it('falls back to the default when no rule matches', () => {
    const registry = createPermissionRegistry({ rules: [], default: 'ask' });
    expect(registry.check({ tool: 'Bash', args: '{}' }).decision).toBe('ask');
  });

  it('returns the matching rule decision when one rule matches', () => {
    const registry = createPermissionRegistry({
      rules: [{ tool: 'Read', decision: 'allow' }],
      default: 'ask',
    });
    const result = registry.check({ tool: 'Read', args: '{}' });
    expect(result.decision).toBe('allow');
    expect(result.matched).toEqual({ tool: 'Read', decision: 'allow' });
  });

  it('prefers deny over ask and allow when several rules match', () => {
    const registry = createPermissionRegistry({
      rules: [
        { tool: 'Bash', decision: 'allow' },
        { tool: 'Bash', decision: 'deny' },
        { tool: 'Bash', decision: 'ask' },
      ],
      default: 'allow',
    });
    expect(registry.check({ tool: 'Bash', args: '{}' }).decision).toBe('deny');
  });

  it('prefers ask over allow when no deny matches', () => {
    const registry = createPermissionRegistry({
      rules: [
        { tool: 'Bash', decision: 'allow' },
        { tool: 'Bash', decision: 'ask' },
      ],
      default: 'allow',
    });
    expect(registry.check({ tool: 'Bash', args: '{}' }).decision).toBe('ask');
  });

  it('applies the * tool rule to any tool', () => {
    const registry = createPermissionRegistry({
      rules: [{ tool: '*', decision: 'ask' }],
      default: 'allow',
    });
    expect(registry.check({ tool: 'AnythingAtAll', args: '{}' }).decision).toBe('ask');
  });

  it('respects argsPattern when present', () => {
    const registry = createPermissionRegistry({
      rules: [
        { tool: 'Bash', argsPattern: '*"rm *', decision: 'deny' },
        { tool: 'Bash', decision: 'allow' },
      ],
      default: 'ask',
    });
    expect(registry.check({ tool: 'Bash', args: '{"command":"rm -rf /"}' }).decision).toBe('deny');
    expect(registry.check({ tool: 'Bash', args: '{"command":"ls"}' }).decision).toBe('allow');
  });

  it('returns the highest-precedence matching rule in `matched`', () => {
    const denyRule = { tool: 'Bash', argsPattern: '*rm*', decision: 'deny' as const };
    const askRule = { tool: 'Bash', decision: 'ask' as const };
    const registry = createPermissionRegistry({
      rules: [askRule, denyRule],
      default: 'allow',
    });
    const result = registry.check({ tool: 'Bash', args: '{"command":"rm -rf /"}' });
    expect(result.matched).toBe(denyRule);
  });
});
