import { expect, test } from 'vitest';
import type { Tool } from 'mu-core';
import { allowList, filterTools } from './allow-list';

const tool = (name: string): Tool => ({ name, description: '', parameters: {}, run: async () => [] });

test('filterTools: deny-by-default, only the listed tools pass', () => {
  const pool = [tool('read'), tool('bash'), tool('write')];
  expect(filterTools(pool, ['read', 'write']).map((t) => t.name)).toEqual(['read', 'write']);
  expect(filterTools(pool, undefined)).toEqual([]);
  expect(filterTools(pool, [])).toEqual([]);
});

test('filterTools: supports globs (and array of globs)', () => {
  const pool = [tool('read'), tool('mcp__search'), tool('mcp__fetch'), tool('bash')];
  expect(filterTools(pool, ['mcp__*']).map((t) => t.name)).toEqual(['mcp__search', 'mcp__fetch']);
  expect(filterTools(pool, ['read', 'mcp__*']).map((t) => t.name)).toEqual(['read', 'mcp__search', 'mcp__fetch']);
  expect(filterTools(pool, ['*']).length).toEqual(4);
});

test('allowList: prepareRequest hook that filters the schema', async () => {
  const hook = allowList(['read']);
  const out = await hook.prepareRequest?.({ system: 's', tools: [tool('read'), tool('bash')] });
  expect(out?.tools?.map((t) => t.name)).toEqual(['read']);
});
