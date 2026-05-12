import { describe, expect, it } from 'bun:test';
import type { ChatMessageMeta } from '../messageMeta';
import { readMetaNumber, readMetaString } from './readMeta';

describe('readMetaString', () => {
  it('returns the string value when set', () => {
    const meta: ChatMessageMeta = { agent: 'arya' };
    expect(readMetaString(meta, 'agent')).toBe('arya');
  });

  it('returns undefined when meta is undefined', () => {
    expect(readMetaString(undefined, 'agent')).toBeUndefined();
  });

  it('returns undefined when key not set', () => {
    expect(readMetaString({}, 'agent')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    const meta: ChatMessageMeta = { ts: 123 };
    expect(readMetaString(meta, 'ts')).toBeUndefined();
  });
});

describe('readMetaNumber', () => {
  it('returns the number when set', () => {
    const meta: ChatMessageMeta = { ts: 42 };
    expect(readMetaNumber(meta, 'ts')).toBe(42);
  });

  it('returns fallback when meta is undefined', () => {
    expect(readMetaNumber(undefined, 'ts', 100)).toBe(100);
  });

  it('returns fallback when key not set', () => {
    expect(readMetaNumber({}, 'ts', 100)).toBe(100);
  });

  it('returns fallback for non-number values', () => {
    const meta: ChatMessageMeta = { agent: 'arya' };
    expect(readMetaNumber(meta, 'agent', 7)).toBe(7);
  });
});
