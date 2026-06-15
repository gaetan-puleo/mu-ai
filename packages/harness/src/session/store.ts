import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import type { Message } from 'mu-core';

export interface StoredSession {
  id: string;
  messages: Message[];
}

export interface SessionStore {
  load(id: string): Promise<StoredSession>;
  append(id: string, messages: Message[]): Promise<void>;
  rewrite(id: string, messages: readonly Message[]): Promise<void>;
  delete(id: string): Promise<void>;
}

const EXT = '.jsonl';

// Binary attachment bytes (image/audio `data`) are Uint8Array. Plain JSON turns
// those into a lossy `{"0":..,"1":..}` object that rehydrates as an Object, not a
// Uint8Array — which then crashes every downstream `Buffer.from(part.data)` /
// `data.subarray(...)` on reload (history, resume, reconnect). Tag them as base64
// on write and rebuild the Uint8Array on read so binary round-trips losslessly.
const BIN_TAG = '__u8b64__';

const binReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Uint8Array ? { [BIN_TAG]: Buffer.from(value).toString('base64') } : value;

const binReviver = (_key: string, value: unknown): unknown =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as Record<string, unknown>)[BIN_TAG] === 'string'
    ? new Uint8Array(Buffer.from((value as Record<string, string>)[BIN_TAG], 'base64'))
    : value;

const serialize = (message: Message): string => `${JSON.stringify(message, binReplacer)}\n`;

const fileFor = (dir: string, id: string): string => {
  if (!/^[\w-]+$/.test(id)) throw new Error(`SessionStore: invalid session id "${id}"`);
  return join(dir, `${id}${EXT}`);
};

export const createSessionStore = ({ dir }: { dir: string }): SessionStore => ({
  load: async (id) => {
    const raw = await readFile(fileFor(dir, id), 'utf-8');
    const messages = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line, binReviver) as Message);
    return { id, messages };
  },
  append: async (id, messages) => {
    if (messages.length === 0) return;
    await mkdir(dir, { recursive: true });
    await appendFile(fileFor(dir, id), messages.map(serialize).join(''));
  },
  rewrite: async (id, messages) => {
    await mkdir(dir, { recursive: true });
    // Atomic replace: write to a sibling temp file and rename over the target.
    // A plain writeFile truncates first, so a crash/ENOSPC mid-write (rewrite is
    // triggered unattended by auto-compaction on long sessions) would leave the
    // .jsonl truncated or with a half-written final line — corrupting or losing
    // the whole conversation on next load. rename() is atomic within a filesystem,
    // so a crash leaves the previous good file intact.
    const target = fileFor(dir, id);
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(tmp, messages.map(serialize).join(''));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  },
  delete: async (id) => {
    await rm(fileFor(dir, id), { force: true });
  },
});
