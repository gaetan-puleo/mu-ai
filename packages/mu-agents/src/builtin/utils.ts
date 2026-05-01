/**
 * Sanitize a file path from LLM arguments.
 * Local models often wrap paths in extra quotes or add whitespace.
 */
export function sanitizePath(raw: string): string {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  return p;
}
