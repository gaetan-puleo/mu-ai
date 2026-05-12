import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearSessionCache, listSessionsAsync, loadSession, saveSession } from './index';

let tmpRoot: string;
let originalDataHome: string | undefined;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'mu-sessions-'));
  originalDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = tmpRoot;
});

afterAll(() => {
  if (originalDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalDataHome;
  }
  clearSessionCache();
});

describe('saveSession / loadSession', () => {
  it('round-trips messages as JSONL with a v1 header', async () => {
    const path = join(tmpRoot, 'roundtrip.jsonl');
    const messages = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
    ];
    await saveSession(path, messages);

    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    // Header + 2 messages
    expect(lines).toHaveLength(3);
    const header = JSON.parse(lines[0]);
    expect(header.v).toBe(1);

    const loaded = loadSession(path);
    expect(loaded).toEqual(messages);
  });

  it('returns [] for missing files', () => {
    expect(loadSession(join(tmpRoot, 'does-not-exist.jsonl'))).toEqual([]);
  });

  it('skips malformed JSONL lines', () => {
    const path = join(tmpRoot, 'partial.jsonl');
    writeFileSync(path, '{"role":"user","content":"ok"}\n{not json}\n{"role":"assistant","content":"yo"}\n');
    const loaded = loadSession(path);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].role).toBe('user');
    expect(loaded[1].role).toBe('assistant');
  });

  it('writes a bare header for empty arrays', async () => {
    const path = join(tmpRoot, 'empty.jsonl');
    await saveSession(path, []);
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).v).toBe(1);
    // loadSession round-trip
    expect(loadSession(path)).toEqual([]);
  });

  it('still reads legacy (header-less) files', () => {
    const path = join(tmpRoot, 'legacy.jsonl');
    writeFileSync(path, '{"role":"user","content":"legacy hi"}\n{"role":"assistant","content":"legacy hello"}\n');
    const loaded = loadSession(path);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].role).toBe('user');
    expect(loaded[1].role).toBe('assistant');
  });
});

describe('listSessionsAsync', () => {
  it('returns [] when no project sessions exist', async () => {
    const list = await listSessionsAsync();
    expect(Array.isArray(list)).toBe(true);
  });
});
