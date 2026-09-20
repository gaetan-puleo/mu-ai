import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PluginStore {
  write(name: string, content: string): Promise<string>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

const fileFor = (dir: string, name: string): string => {
  if (name.includes('/') || name.includes('..') || name === '') throw new Error(`PluginStore: invalid name "${name}"`);
  return join(dir, name);
};

export const createPluginStore = ({ dir }: { dir: string }): PluginStore => ({
  write: async (name, content) => {
    const path = fileFor(dir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path, content, 'utf-8');
    return path;
  },
  list: async () => {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  },
  remove: async (name) => {
    await rm(fileFor(dir, name), { force: true });
  },
});
