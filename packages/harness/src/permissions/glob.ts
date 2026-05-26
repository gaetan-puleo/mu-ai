/**
 * Compile a simple glob into a RegExp.
 *
 * Supported metacharacters:
 *   `*`  — matches zero or more of any character
 *   `?`  — matches exactly one of any character
 *
 * All other regex metacharacters are escaped, so the pattern matches literally.
 * Matching is anchored: the whole input must match.
 */
export function compileGlob(pattern: string): RegExp {
  let regex = '';
  for (const ch of pattern) {
    if (ch === '*') regex += '.*';
    else if (ch === '?') regex += '.';
    else regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${regex}$`);
}

export function matchTool(ruleTool: string, callTool: string): boolean {
  return ruleTool === '*' || ruleTool === callTool;
}

export function matchArgs(pattern: string | undefined, args: string): boolean {
  if (pattern === undefined) return true;
  return compileGlob(pattern).test(args);
}
