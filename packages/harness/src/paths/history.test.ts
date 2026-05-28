import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryStore } from './history';

describe('createHistoryStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when the file is missing', () => {
    const h = createHistoryStore({ path: join(dir, 'history.json') });
    expect(h.load()).toEqual([]);
  });

  it('appends and reloads', () => {
    const h = createHistoryStore({ path: join(dir, 'history.json') });
    h.append('one');
    h.append('two');
    expect(h.load()).toEqual(['one', 'two']);
  });

  it('drops consecutive duplicates', () => {
    const h = createHistoryStore({ path: join(dir, 'history.json') });
    h.append('a');
    h.append('a');
    h.append('b');
    h.append('b');
    expect(h.load()).toEqual(['a', 'b']);
  });

  it('caps at max entries', () => {
    const h = createHistoryStore({ path: join(dir, 'history.json'), max: 3 });
    h.append('one');
    h.append('two');
    h.append('three');
    h.append('four');
    expect(h.load()).toEqual(['two', 'three', 'four']);
  });

  it('survives a corrupt file by treating it as empty', () => {
    const path = join(dir, 'history.json');
    writeFileSync(path, 'not json');
    const h = createHistoryStore({ path });
    expect(h.load()).toEqual([]);
    h.append('after-corrupt');
    expect(h.load()).toEqual(['after-corrupt']);
  });
});
