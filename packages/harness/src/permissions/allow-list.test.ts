import { assertEquals } from '@std/assert';
import type { Tool } from 'mu-core';
import { allowList, filterTools } from './allow-list';

const tool = (name: string): Tool => ({ name, description: '', parameters: {}, run: async () => [] });

Deno.test('filterTools: deny-by-default, only the listed tools pass', () => {
  const pool = [tool('read'), tool('bash'), tool('write')];
  assertEquals(filterTools(pool, ['read', 'write']).map((t) => t.name), ['read', 'write']);
  assertEquals(filterTools(pool, undefined), []);
  assertEquals(filterTools(pool, []), []);
});

Deno.test('filterTools: supports globs (and array of globs)', () => {
  const pool = [tool('read'), tool('mcp__search'), tool('mcp__fetch'), tool('bash')];
  assertEquals(filterTools(pool, ['mcp__*']).map((t) => t.name), ['mcp__search', 'mcp__fetch']);
  assertEquals(filterTools(pool, ['read', 'mcp__*']).map((t) => t.name), ['read', 'mcp__search', 'mcp__fetch']);
  assertEquals(filterTools(pool, ['*']).length, 4);
});

Deno.test('allowList: prepareRequest hook that filters the schema', async () => {
  const hook = allowList(['read']);
  const out = await hook.prepareRequest?.({ system: 's', tools: [tool('read'), tool('bash')] });
  assertEquals(out?.tools?.map((t) => t.name), ['read']);
});
