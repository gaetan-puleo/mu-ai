import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newMessage } from 'mu-core';
import { appendMessage, listSessions, readSession, readSessionHeader, type SessionHeader, writeHeader } from './jsonl';

let dir: string;

const HEADER: SessionHeader = {
  kind: 'header',
  version: 1,
  id: 'sess_test',
  createdAt: 1715600000000,
  cwd: '/tmp/proj',
  model: 'qwen',
  baseUrl: 'http://localhost:11434/v1',
  source: 'mu-coding',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mu-store-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('jsonl', () => {
  it('round-trips a header + several messages', async () => {
    const path = join(dir, `${HEADER.id}.jsonl`);
    await writeHeader(path, HEADER);
    const m1 = newMessage({ role: 'user', content: 'hello' });
    const m2 = newMessage({ role: 'assistant', content: 'hi' });
    await appendMessage(path, m1);
    await appendMessage(path, m2);

    const loaded = await readSession(path);
    expect(loaded.header).toEqual(HEADER);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('hello');
    expect(loaded.messages[1].content).toBe('hi');
  });

  it('writeHeader refuses to overwrite an existing file', async () => {
    const path = join(dir, `${HEADER.id}.jsonl`);
    await writeHeader(path, HEADER);
    await expect(writeHeader(path, HEADER)).rejects.toThrow(/already exists/);
  });

  it('readSessionHeader reads only the first line', async () => {
    const path = join(dir, `${HEADER.id}.jsonl`);
    await writeHeader(path, HEADER);
    await appendMessage(path, newMessage({ role: 'user', content: 'x' }));
    const header = await readSessionHeader(path);
    expect(header).toEqual(HEADER);
  });

  it('readSession surfaces a descriptive error on a corrupt line', async () => {
    const path = join(dir, `${HEADER.id}.jsonl`);
    await writeHeader(path, HEADER);
    // Append a non-JSON line directly to simulate corruption.
    writeFileSync(path, '{ not json\n', { flag: 'a' });
    await expect(readSession(path)).rejects.toThrow(/line 2/);
  });

  it('rejects an unsupported schema version', async () => {
    const path = join(dir, 'bad.jsonl');
    writeFileSync(path, `${JSON.stringify({ ...HEADER, version: 99 })}\n`);
    await expect(readSession(path)).rejects.toThrow(/unsupported session schema version/);
  });

  it('listSessions returns summaries sorted newest first and skips corrupt files', async () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    const c = join(dir, 'c.jsonl');
    await writeHeader(a, { ...HEADER, id: 'a' });
    // Sleep a tick so mtime differs deterministically.
    await new Promise((r) => setTimeout(r, 10));
    await writeHeader(b, { ...HEADER, id: 'b' });
    // Corrupt file should be skipped, not blow up the listing.
    writeFileSync(c, 'garbage\n');

    const list = await listSessions(dir);
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('listSessions returns [] for a missing directory', async () => {
    const list = await listSessions(join(dir, 'missing'));
    expect(list).toEqual([]);
  });
});
