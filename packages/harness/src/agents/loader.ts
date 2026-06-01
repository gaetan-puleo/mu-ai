import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseAgent } from './parser';
import type { Agent } from './types';

export const loadAgents = async (dir: string): Promise<Agent[]> => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((name) => name.endsWith('.md')).sort();
  const agents: Agent[] = [];
  for (const file of files) {
    try {
      const source = await readFile(join(dir, file), 'utf-8');
      agents.push(parseAgent(source, basename(file, '.md')));
    } catch {
      continue;
    }
  }
  return agents;
};
