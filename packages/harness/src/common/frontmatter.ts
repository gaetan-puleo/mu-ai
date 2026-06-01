import { parse as parseYaml } from '@std/yaml';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface Frontmatter {
  fields: Record<string, unknown>;
  body: string;
}

export const parseFrontmatter = (source: string): Frontmatter => {
  const match = source.match(FRONTMATTER);
  let fields: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed = parseYaml(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
    } catch {
      fields = {};
    }
  }
  return { fields, body: (match ? match[2] : source).trim() };
};

export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
