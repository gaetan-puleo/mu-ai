import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonlSessionStore } from './jsonl-store';

describe('jsonl-store readMessages', () => {
  let dir: string;
  let origError: typeof console.error;
  let errors: unknown[][];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jsonl-store-corrupt-'));
    errors = [];
    origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
  });

  afterEach(() => {
    console.error = origError;
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips a corrupted line and surfaces a parse error', () => {
    const id = 's_test_corrupt';
    const file = join(dir, `${id}.jsonl`);
    writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify({ title: 't', createdAt: 1 }));
    appendFileSync(file, `${JSON.stringify({ role: 'user', content: 'ok' })}\n`, 'utf-8');
    // Truncated line — missing closing brace; surrounded by valid lines.
    appendFileSync(file, '{"role":"user","content":"bro\n', 'utf-8');
    appendFileSync(file, `${JSON.stringify({ role: 'assistant', content: 'reply' })}\n`, 'utf-8');

    // Fresh store so readMessages runs on disk for the first time.
    const reloaded = createJsonlSessionStore(dir).get(id);
    expect(reloaded?.messages.length).toBe(2);
    expect(reloaded?.messages[0].content).toBe('ok');
    expect(reloaded?.messages[1].content).toBe('reply');
    expect(errors.some((args) => String(args[0]).includes('malformed transcript line'))).toBe(true);
  });

  it('writes a complete JSONL line per persistOnBus event', () => {
    const store = createJsonlSessionStore(dir);
    const session = store.create({});
    const bus = {
      listeners: new Set<(e: unknown) => void>(),
      subscribe(fn: (e: unknown) => void) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      },
      publish(e: unknown) {
        for (const fn of this.listeners) fn(e);
      },
    };
    // deno-lint-ignore no-explicit-any
    const unsubscribe = store.persistOnBus(bus as any, session.id);
    bus.publish({ type: 'user_message', message: { role: 'user', content: 'hi' } });
    bus.publish({ type: 'assistant_message', message: { role: 'assistant', content: 'hello' } });
    unsubscribe();

    const file = join(dir, `${session.id}.jsonl`);
    const raw = readFileSync(file, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ role: 'user', content: 'hi' });
    expect(JSON.parse(lines[1])).toEqual({ role: 'assistant', content: 'hello' });
    expect(raw.endsWith('\n')).toBe(true);
  });
});

describe('jsonl-store create/fork id uniqueness', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jsonl-store-collision-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not reuse an id when create runs many times in the same tick', () => {
    const store = createJsonlSessionStore(dir);
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = store.create({});
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
    expect(ids.size).toBe(100);
  });

  it('regenerates a fresh id when fork hits an existing transcript', () => {
    const store = createJsonlSessionStore(dir);
    const seed = store.create({ messages: [{ role: 'user', content: 'go' }] });
    // Pre-seed every plausible id for this millisecond by writing many meta files.
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const fork = store.fork(seed.id, 0, {});
      expect(ids.has(fork.id)).toBe(false);
      ids.add(fork.id);
    }
    expect(ids.size).toBe(200);
  });
});
