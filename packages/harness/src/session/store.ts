import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from 'mu-core';

export interface StoredSession {
  id: string;
  messages: Message[];
}

export interface SessionStore {
  load(id: string): Promise<StoredSession>;
  append(id: string, messages: Message[]): Promise<void>;
  delete(id: string): Promise<void>;
}

const EXT = '.jsonl';

const fileFor = (dir: string, id: string): string => {
  if (!/^[\w-]+$/.test(id)) throw new Error(`SessionStore: invalid session id "${id}"`);
  return join(dir, `${id}${EXT}`);
};

export const createSessionStore = ({ dir }: { dir: string }): SessionStore => ({
  load: async (id) => {
    const raw = await readFile(fileFor(dir, id), 'utf-8');
    const messages = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Message);
    return { id, messages };
  },
  append: async (id, messages) => {
    if (messages.length === 0) return;
    await mkdir(dir, { recursive: true });
    await appendFile(fileFor(dir, id), messages.map((message) => `${JSON.stringify(message)}\n`).join(''));
  },
  delete: async (id) => {
    await rm(fileFor(dir, id), { force: true });
  },
});
