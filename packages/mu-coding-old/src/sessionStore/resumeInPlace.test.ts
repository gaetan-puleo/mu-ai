/**
 * Regression test for `/sessions` in-place resume.
 *
 * Contract: selecting a saved session reopens THAT session — same id,
 * same on-disk file. Future appends extend the original file rather
 * than creating a fork.
 *
 * This file pins the disk-level invariant:
 *
 *   1. Pre-existing JSONL with messages M1..Mn.
 *   2. Resume = attachAutoPersist(session_with_old_id, { resumeExisting:true })
 *      on the original file path.
 *   3. Appending Mn+1 to the in-memory session writes it to the same file;
 *      no new file appears in the directory.
 *
 * The in-memory `Session` seeding is mu-core's concern and is covered by
 * its own constructor tests — here we only care that autopersist points
 * at the original file and that no second file is created.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newMessage, type SessionEvent } from 'mu-core';
import { attachAutoPersist } from './attachAutoPersist';
import { appendMessage, readSession, type SessionHeader, writeHeader } from './jsonl';

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

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mu-resume-inplace-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('in-place resume', () => {
  it('extends the original file without creating a fork', async () => {
    // Step 1: lay down a pre-existing session file with two messages.
    const sessionId = 'sess_in_place_1';
    const filePath = join(dir, `${sessionId}.jsonl`);
    const headerCore: Omit<SessionHeader, 'kind' | 'version'> = {
      id: sessionId,
      createdAt: 1715600000000,
      cwd: '/tmp',
      model: 'qwen',
      baseUrl: 'http://localhost:11434/v1',
      source: 'mu-coding',
    };
    await writeHeader(filePath, { kind: 'header', version: 1, ...headerCore });
    await appendMessage(filePath, newMessage({ role: 'user', content: 'original-1' }));
    await appendMessage(filePath, newMessage({ role: 'assistant', content: 'original-2' }));

    const filesBefore = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(filesBefore).toEqual([`${sessionId}.jsonl`]);

    // Step 2: simulate resume — attach autopersist with resumeExisting:true
    // on the original path under the original id.
    const session = createStubSession(sessionId);
    // biome-ignore lint/suspicious/noExplicitAny: stub only implements the subset attachAutoPersist uses
    const off = await attachAutoPersist(session as any, {
      header: headerCore,
      filePath,
      resumeExisting: true,
    });

    // Step 3: emit a new message_appended event (this is what mu-core does
    // when Session.append() is called for a real turn after resume).
    session.emit({
      type: 'message_appended',
      // biome-ignore lint/suspicious/noExplicitAny: session field unused by the persister
      session: session as any,
      message: newMessage({ role: 'user', content: 'post-resume-3' }),
    });
    await flush();
    off();

    // Invariant 1: still ONE file in the directory — no fork.
    const filesAfter = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(filesAfter).toEqual([`${sessionId}.jsonl`]);

    // Invariant 2: the original file now contains all three messages in order.
    const loaded = await readSession(filePath);
    expect(loaded.header.id).toBe(sessionId);
    expect(loaded.messages.map((m) => m.content)).toEqual(['original-1', 'original-2', 'post-resume-3']);
  });

  it('resuming twice does not duplicate messages', async () => {
    // Each resume re-attaches autopersist in resumeExisting:true mode.
    // The listener writes only message_appended events emitted AFTER
    // attach; the pre-existing on-disk messages are not re-written.
    const sessionId = 'sess_in_place_2';
    const filePath = join(dir, `${sessionId}.jsonl`);
    const headerCore: Omit<SessionHeader, 'kind' | 'version'> = {
      id: sessionId,
      createdAt: 1,
      cwd: '/tmp',
      baseUrl: 'http://localhost:11434/v1',
    };
    await writeHeader(filePath, { kind: 'header', version: 1, ...headerCore });
    await appendMessage(filePath, newMessage({ role: 'user', content: 'only' }));

    // Resume #1: attach, then detach without emitting anything.
    const s1 = createStubSession(sessionId);
    // biome-ignore lint/suspicious/noExplicitAny: stub
    const off1 = await attachAutoPersist(s1 as any, { header: headerCore, filePath, resumeExisting: true });
    off1();

    // Resume #2: attach again on the same file, emit a new message.
    const s2 = createStubSession(sessionId);
    // biome-ignore lint/suspicious/noExplicitAny: stub
    const off2 = await attachAutoPersist(s2 as any, { header: headerCore, filePath, resumeExisting: true });
    s2.emit({
      type: 'message_appended',
      // biome-ignore lint/suspicious/noExplicitAny: stub
      session: s2 as any,
      message: newMessage({ role: 'user', content: 'after-second-resume' }),
    });
    await flush();
    off2();

    const loaded = await readSession(filePath);
    expect(loaded.messages.map((m) => m.content)).toEqual(['only', 'after-second-resume']);
  });
});
