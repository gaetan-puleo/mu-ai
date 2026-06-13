import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ContentPart, text, type Tool } from 'mu-core';

/** Cap per scope so a runaway memory file can't dominate the context (≈ Claude Code's 25KB). */
const MAX_BYTES = 24 * 1024;

export type MemoryScope = 'local' | 'global';

export interface MemoryStore {
  /** Project-scoped memory file (cwd/.mu/MEMORY.md). */
  readonly localPath: string;
  /** Global memory file (dataDir/MEMORY.md), shared across all projects. */
  readonly globalPath: string;
  /** Concatenated memory (global then project), capped per scope, or undefined when empty. */
  load(): Promise<string | undefined>;
  /** Append a durable fact to the chosen scope's memory file. */
  remember(fact: string, scope: MemoryScope): Promise<void>;
}

export function createMemoryStore(opts: { cwd: string; dataDir: string }): MemoryStore {
  const localPath = join(opts.cwd, '.mu', 'MEMORY.md');
  const globalPath = join(opts.dataDir, 'MEMORY.md');

  const readCapped = async (path: string): Promise<string | undefined> => {
    const raw = await readFile(path, 'utf-8').catch(() => undefined);
    if (!raw || !raw.trim()) return undefined;
    return raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw.trim();
  };

  return {
    localPath,
    globalPath,
    async load() {
      const parts: string[] = [];
      const global = await readCapped(globalPath);
      if (global) parts.push(`<!-- global -->\n${global}`);
      const project = await readCapped(localPath);
      if (project) parts.push(`<!-- project -->\n${project}`);
      return parts.length > 0 ? parts.join('\n\n') : undefined;
    },
    async remember(fact, scope) {
      const path = scope === 'global' ? globalPath : localPath;
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `- ${fact.trim()}\n`, 'utf-8');
    },
  };
}

/** A `remember` tool the agent calls to persist durable facts to local or global memory. */
export function createRememberTool(store: MemoryStore): Tool {
  return {
    name: 'remember',
    description:
      'Persist a durable fact to memory for future sessions (stable facts/preferences, not transient details). Scope: local = this project (default), global = all projects.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One concise sentence to remember.' },
        scope: { type: 'string', enum: ['local', 'global'], description: 'local (this project, default) or global (all projects).' },
      },
      required: ['fact'],
      additionalProperties: false,
    },
    async run(input): Promise<ContentPart[]> {
      const args = (input ?? {}) as { fact?: unknown; scope?: unknown };
      const fact = typeof args.fact === 'string' ? args.fact.trim() : '';
      if (!fact) return [text('Error: remember requires `fact` (string)')];
      const scope: MemoryScope = args.scope === 'global' ? 'global' : 'local';
      await store.remember(fact, scope);
      return [text(`Remembered (${scope}): ${fact}`)];
    },
  };
}
