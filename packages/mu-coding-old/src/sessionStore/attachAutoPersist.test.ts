import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Message, newMessage, type SessionEvent } from 'mu-core';
import { attachAutoPersist } from './attachAutoPersist';
import { readSession, type SessionHeader } from './jsonl';

// Minimal Session-shaped stub. attachAutoPersist only uses .id and .on().
interface StubSession {
  id: string;
  on: (fn: (ev: SessionEvent) => void) => () => void;
  emit: (ev: SessionEvent) => void;
}

function createStubSession(id: string): StubSession {
  const listeners = new Set<(ev: SessionEvent) => void>();
  return {
    id,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(ev) {
      for (const fn of listeners) fn(ev);
    },
  };
}

const HEADER_BASE: Omit<SessionHeader, 'kind' | 'version'> = {
  id: 'sess_x',
  createdAt: 1715600000000,
  cwd: '/tmp',
  model: 'qwen',
  baseUrl: 'http://localhost:11434/v1',
  source: 'mu-coding',
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mu-persist-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function flush(): Promise<void> {
  // Let the void-cast appendMessage promise inside the listener resolve.
  await new Promise((r) => setTimeout(r, 20));
}

describe('attachAutoPersist — write path', () => {
  it('writes header on attach and appends non-transient messages', async () => {
    const filePath = join(dir, 'sess.jsonl');
    const session = createStubSession('sess_x');
    // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
    const off = await attachAutoPersist(session as any, { header: HEADER_BASE, filePath });

    session.emit({
      type: 'message_appended',
      // biome-ignore lint/suspicious/noExplicitAny: session field unused by the persister
      session: session as any,
      message: newMessage({ role: 'user', content: 'hi' }),
    });
    await flush();

    const loaded = await readSession(filePath);
    expect(loaded.header.id).toBe('sess_x');
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].content).toBe('hi');
    off();
  });

  it('skips transient messages', async () => {
    const filePath = join(dir, 'sess.jsonl');
    const session = createStubSession('sess_x');
    // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
    await attachAutoPersist(session as any, { header: HEADER_BASE, filePath });

    const visible: Message = newMessage({ role: 'user', content: 'keep me' });
    const transient: Message = newMessage({
      role: 'system',
      content: 'drop me',
      meta: { transient: true },
    });
    // biome-ignore lint/suspicious/noExplicitAny: session field unused by the persister
    session.emit({ type: 'message_appended', session: session as any, message: visible });
    // biome-ignore lint/suspicious/noExplicitAny: session field unused by the persister
    session.emit({ type: 'message_appended', session: session as any, message: transient });
    await flush();

    const loaded = await readSession(filePath);
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].content).toBe('keep me');
  });
});

describe('attachAutoPersist — resume path', () => {
  it('resumeExisting validates the on-disk header id and skips re-writing', async () => {
    const filePath = join(dir, 'sess.jsonl');
    const first = createStubSession('sess_x');
    // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
    const off1 = await attachAutoPersist(first as any, { header: HEADER_BASE, filePath });
    first.emit({
      type: 'message_appended',
      // biome-ignore lint/suspicious/noExplicitAny: session field unused by the persister
      session: first as any,
      message: newMessage({ role: 'user', content: 'a' }),
    });
    await flush();
    off1();

    const second = createStubSession('sess_x');
    // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
    const off2 = await attachAutoPersist(second as any, {
      header: HEADER_BASE,
      filePath,
      resumeExisting: true,
    });
    second.emit({
      type: 'message_appended',
      // biome-ignore lint/suspicious/noExplicitAny: session field unused by the persister
      session: second as any,
      message: newMessage({ role: 'user', content: 'b' }),
    });
    await flush();
    off2();

    const loaded = await readSession(filePath);
    expect(loaded.messages.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('resumeExisting rejects when ids do not match', async () => {
    const filePath = join(dir, 'sess.jsonl');
    const first = createStubSession('sess_x');
    // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
    await attachAutoPersist(first as any, { header: HEADER_BASE, filePath });

    const second = createStubSession('sess_y');
    await expect(
      attachAutoPersist(
        // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
        second as any,
        { header: { ...HEADER_BASE, id: 'sess_y' }, filePath, resumeExisting: true },
      ),
    ).rejects.toThrow(/id mismatch/);
  });
});
