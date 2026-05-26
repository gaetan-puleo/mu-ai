import { parse as parseYaml } from '@std/yaml';

export interface Frontmatter {
  /** YAML frontmatter values. Scalar leaves are kept verbatim; nested maps/arrays stay structured. */
  fields: Record<string, unknown>;
  body: string;
}

/**
 * Parse a Markdown file with optional `---` YAML frontmatter at the top.
 * The frontmatter is parsed with `yaml`, so nested maps and arrays are
 * preserved (e.g. `tools: { read: allow, write: { "src/**": ask } }`).
 *
 * When there's no frontmatter, returns an empty `fields` map and the full
 * source as `body`.
 */
export function parseFrontmatter(source: string): Frontmatter {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { fields: {}, body: source };
  }

  const newlineAfterOpen = source.indexOf('\n', 3);
  const closeMarker = source.indexOf('\n---', newlineAfterOpen);
  if (closeMarker === -1) {
    return { fields: {}, body: source };
  }

  const block = source.slice(newlineAfterOpen + 1, closeMarker);
  const afterClose = source.indexOf('\n', closeMarker + 4);
  const body = afterClose === -1 ? '' : source.slice(afterClose + 1);

  let parsed: unknown;
  try {
    parsed = parseYaml(block);
  } catch {
    return { fields: {}, body };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { fields: {}, body };
  }
  return { fields: parsed as Record<string, unknown>, body };
}
