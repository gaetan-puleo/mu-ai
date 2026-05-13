import { describe, expect, it } from 'bun:test';
import { parsePermissions, resolveAction } from './permissions';

describe('parsePermissions', () => {
  it('treats undefined as allow-all', () => {
    expect(parsePermissions(undefined)).toEqual({ permissions: undefined, allowList: ['*'] });
  });

  it('parses comma-separated string', () => {
    expect(parsePermissions('bash, read, edit')).toEqual({
      permissions: undefined,
      allowList: ['bash', 'read', 'edit'],
    });
  });

  it('parses an array as allow-list', () => {
    expect(parsePermissions(['bash', 'read'])).toEqual({
      permissions: undefined,
      allowList: ['bash', 'read'],
    });
  });

  it('parses structured map and derives allow-list', () => {
    const { permissions, allowList } = parsePermissions({
      bash: { 'git *': 'allow', '*': 'ask' },
      read: 'allow',
      write: 'deny',
    });
    expect(permissions).toEqual({
      bash: { 'git *': 'allow', '*': 'ask' },
      read: 'allow',
      write: 'deny',
    });
    // 'write: deny' excluded; 'read' included; 'bash' included
    expect(allowList.sort()).toEqual(['bash', 'read']);
  });
});

describe('resolveAction', () => {
  it('returns shorthand action directly', () => {
    expect(resolveAction('allow', 'anything')).toEqual({ action: 'allow', rule: '*' });
    expect(resolveAction('deny', undefined)).toEqual({ action: 'deny', rule: '*' });
  });

  it('walks glob map in order, first match wins', () => {
    const perm = { 'git *': 'allow' as const, 'rm -rf *': 'deny' as const, '*': 'ask' as const };
    expect(resolveAction(perm, 'git status')).toEqual({ action: 'allow', rule: 'git *' });
    expect(resolveAction(perm, 'rm -rf /tmp')).toEqual({ action: 'deny', rule: 'rm -rf *' });
    expect(resolveAction(perm, 'ls -la')).toEqual({ action: 'ask', rule: '*' });
  });

  it('falls back to deny when nothing matches', () => {
    expect(resolveAction({ 'git *': 'allow' }, 'ls')).toEqual({
      action: 'deny',
      rule: 'no-match',
    });
  });

  it('uses * fallback when matchKey is undefined', () => {
    expect(resolveAction({ 'git *': 'allow', '*': 'ask' }, undefined)).toEqual({
      action: 'ask',
      rule: '*',
    });
  });
});
