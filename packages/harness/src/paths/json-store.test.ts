import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonStore } from './json-store';

interface Shape {
  name?: string;
  count?: number;
}

const validate = (obj: Record<string, unknown>): Shape => {
  const out: Shape = {};
  if (typeof obj.name === 'string') out.name = obj.name;
  if (typeof obj.count === 'number') out.count = obj.count;
  return out;
};

describe('createJsonStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'json-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the validator empty shape when the file is absent', () => {
    const store = createJsonStore<Shape>({ path: join(dir, 'missing.json'), validate });
    expect(store.load()).toEqual({});
  });

  it('round-trips values through validate', () => {
    const path = join(dir, 'state.json');
    const store = createJsonStore<Shape>({ path, validate });
    store.save({ name: 'a', count: 2 });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ name: 'a', count: 2 });
    expect(store.load()).toEqual({ name: 'a', count: 2 });
  });

  it('drops unknown keys via the validator', () => {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ name: 'a', evil: 'x' }));
    const store = createJsonStore<Shape>({ path, validate });
    expect(store.load()).toEqual({ name: 'a' });
  });

  it('falls back to empty shape on parse error and invokes onParseError', () => {
    const path = join(dir, 'corrupt.json');
    writeFileSync(path, '{not json');
    const errors: unknown[] = [];
    const store = createJsonStore<Shape>({
      path,
      validate,
      onParseError: (_p, e) => errors.push(e),
    });
    expect(store.load()).toEqual({});
    expect(errors.length).toBe(1);
  });

  it('creates parent dirs on save', () => {
    const path = join(dir, 'nested', 'deep', 'state.json');
    const store = createJsonStore<Shape>({ path, validate });
    store.save({ count: 1 });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ count: 1 });
  });
});
