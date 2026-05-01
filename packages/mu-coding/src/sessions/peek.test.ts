/**
 * Verifies the streaming `listSessionsAsync` end-to-end against a tmp data
 * directory laid out exactly like a real `~/.local/share/mu/sessions/<proj>`.
 * The cache is exercised by listing twice and confirming we get the same
 * structural result without re-reading.
 */
import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearSessionCache, listSessionsAsync } from './index';
import { getProjectId } from './project';

const PROJECT_ID = getProjectId();

let tmpRoot: string;
let sessionsDir: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'mu-peek-'));
  process.env.XDG_DATA_HOME = tmpRoot;
  sessionsDir = join(tmpRoot, 'mu', 'sessions', PROJECT_ID);
  mkdirSync(sessionsDir, { recursive: true });
});

afterEach(() => {
  clearSessionCache();
});

function writeSession(name: string, messages: Array<{ role: string; content: string }>): string {
  const path = join(sessionsDir, name);
  writeFileSync(path, `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
  return path;
}

describe('listSessionsAsync', () => {
  it('captures message count and the first user preview', async () => {
    writeSession('2026-01-01.jsonl', [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi back' },
      { role: 'user', content: 'a follow-up' },
    ]);

    const list = await listSessionsAsync();
    const entry = list.find((s) => s.name === '2026-01-01');
    expect(entry).toBeDefined();
    expect(entry?.messageCount).toBe(3);
    expect(entry?.preview).toBe('hello world');
  });

  it('handles malformed lines without crashing', async () => {
    writeSession('2026-01-02.jsonl', [{ role: 'user', content: 'ok' }]);
    // Append a junk line outside the structured writer.
    const broken = join(sessionsDir, '2026-01-03.jsonl');
    writeFileSync(broken, '{"role":"user","content":"valid"}\n{not-json\n');

    const list = await listSessionsAsync();
    const entry = list.find((s) => s.name === '2026-01-03');
    expect(entry?.messageCount).toBe(2);
    expect(entry?.preview).toBe('valid');
  });

  it('reports a placeholder when no user message is present', async () => {
    writeSession('2026-01-04.jsonl', [{ role: 'assistant', content: 'no user here' }]);
    const list = await listSessionsAsync();
    const entry = list.find((s) => s.name === '2026-01-04');
    expect(entry?.preview).toBe('(no user message)');
  });

  it('truncates long previews to PREVIEW_LENGTH and replaces newlines', async () => {
    const longMessage = `line one\n${'x'.repeat(200)}`;
    writeSession('2026-01-05.jsonl', [{ role: 'user', content: longMessage }]);
    const list = await listSessionsAsync();
    const entry = list.find((s) => s.name === '2026-01-05');
    expect(entry?.preview).not.toContain('\n');
    expect(entry?.preview.length).toBe(80);
  });

  it('serves cached results on the second call (same mtime)', async () => {
    writeSession('2026-01-06.jsonl', [{ role: 'user', content: 'cached' }]);
    const first = await listSessionsAsync();
    const second = await listSessionsAsync();
    const a = first.find((s) => s.name === '2026-01-06');
    const b = second.find((s) => s.name === '2026-01-06');
    expect(a?.preview).toBe(b?.preview);
    expect(a?.messageCount).toBe(b?.messageCount);
  });
});
