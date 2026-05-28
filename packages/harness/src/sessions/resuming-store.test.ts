import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonlSessionStore } from './jsonl-store';
import { createResumingStore } from './resuming-store';

describe('createResumingStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resuming-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the named session on first create() then falls through', () => {
    const base = createJsonlSessionStore(dir);
    const seeded = base.create({ title: 'seeded' });

    const resuming = createResumingStore(base, seeded.id);

    const first = resuming.create();
    expect(first.id).toBe(seeded.id);
    expect(first.title).toBe('seeded');

    const second = resuming.create({ title: 'fresh' });
    expect(second.id).not.toBe(seeded.id);
    expect(second.title).toBe('fresh');
  });

  it('falls through immediately when the resume id is unknown', () => {
    const base = createJsonlSessionStore(dir);
    const resuming = createResumingStore(base, 'no_such_id');
    const created = resuming.create({ title: 'fresh' });
    expect(created.title).toBe('fresh');
    expect(base.get(created.id)?.title).toBe('fresh');
  });

  it('exposes the rest of the PersistedSessionStore surface', () => {
    const base = createJsonlSessionStore(dir);
    const seeded = base.create({ title: 'seeded' });
    const resuming = createResumingStore(base, seeded.id);

    expect(resuming.summaries().some((s) => s.id === seeded.id)).toBe(true);
    expect(resuming.get(seeded.id)?.id).toBe(seeded.id);
  });
});
