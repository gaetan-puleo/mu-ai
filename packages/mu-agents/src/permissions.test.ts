import { describe, expect, it } from 'bun:test';
import { resolvePermission, validatePermissionMap } from './permissions';

describe('resolvePermission', () => {
  it('denies when rule is undefined', () => {
    expect(resolvePermission(undefined, { toolName: 't', args: {} })).toBe('deny');
  });

  it('returns direct action', () => {
    expect(resolvePermission('allow', { toolName: 't', args: {} })).toBe('allow');
    expect(resolvePermission('deny', { toolName: 't', args: {} })).toBe('deny');
    expect(resolvePermission('ask', { toolName: 't', args: {} })).toBe('ask');
  });

  it('returns first matching glob in declared order', () => {
    const rule = { 'git *': 'allow' as const, 'rm -rf *': 'deny' as const, '*': 'ask' as const };
    const ctx = {
      toolName: 'bash',
      args: { cmd: 'git status' },
      matchKey: (a: Record<string, unknown>) => a.cmd as string,
    };
    expect(resolvePermission(rule, ctx)).toBe('allow');
  });

  it('falls through to later globs when earlier do not match', () => {
    const rule = { 'git *': 'allow' as const, '*': 'ask' as const };
    const ctx = { toolName: 'bash', args: { cmd: 'ls' }, matchKey: (a: Record<string, unknown>) => a.cmd as string };
    expect(resolvePermission(rule, ctx)).toBe('ask');
  });

  it('default deny when no glob matches', () => {
    const rule = { 'git *': 'allow' as const };
    const ctx = { toolName: 'bash', args: { cmd: 'ls' }, matchKey: (a: Record<string, unknown>) => a.cmd as string };
    expect(resolvePermission(rule, ctx)).toBe('deny');
  });

  it('object form denies when matchKey absent', () => {
    const rule = { 'src/**': 'allow' as const };
    expect(resolvePermission(rule, { toolName: 't', args: { path: 'src/x' } })).toBe('deny');
  });

  it('matches dotfiles via dot:true', () => {
    const rule = { '**/.env': 'deny' as const, '**': 'allow' as const };
    const ctx = {
      toolName: 'wf',
      args: { path: 'src/.env' },
      matchKey: (a: Record<string, unknown>) => a.path as string,
    };
    expect(resolvePermission(rule, ctx)).toBe('deny');
  });

  it('handles matchKey that throws', () => {
    const rule = { '*': 'allow' as const };
    const ctx = {
      toolName: 't',
      args: {},
      matchKey: () => {
        throw new Error('bad');
      },
    };
    expect(resolvePermission(rule, ctx)).toBe('deny');
  });
});

describe('validatePermissionMap', () => {
  it('rejects glob form on tool without matchKey', () => {
    expect(() =>
      validatePermissionMap({ subagent: { '*': 'allow' } }, [{ toolName: 'subagent' /* no matchKey */ }]),
    ).toThrow(/matchKey/);
  });

  it('accepts simple form on any tool', () => {
    validatePermissionMap({ subagent: 'allow' }, [{ toolName: 'subagent' }]);
  });

  it('accepts glob form on tool with matchKey', () => {
    validatePermissionMap({ bash: { '*': 'allow' } }, [{ toolName: 'bash', matchKey: (a) => a.cmd as string }]);
  });

  it('skips unknown tools silently', () => {
    validatePermissionMap({ unknown_tool: { '*': 'allow' } }, []);
  });
});
