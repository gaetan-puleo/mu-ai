/**
 * Single source of truth for slash-command detection + parsing. Every place
 * that decides "is this user input a command?" should go through here so a
 * future rule change (e.g. `\/`-escape, alternate prefixes) lands in one spot.
 *
 *   "/new"          → { name: 'new', args: '' }
 *   "/model gpt-4"  → { name: 'model', args: 'gpt-4' }
 *   "/  whitespace" → undefined  (no name after the slash)
 *   "hello"         → undefined
 */
export interface ParsedCommand {
  name: string;
  args: string;
}

const SLASH = '/';
const NAME = /^([A-Za-z][\w-]*)(?:\s+(.*))?$/;

/** True when the trimmed input begins with `/` followed by a command-name char. */
export function isCommandLine(input: string): boolean {
  return parseCommandLine(input) !== undefined;
}

/**
 * Parse a slash-command line. Returns `undefined` for anything that isn't a
 * well-formed command (no slash, slash without a name, whitespace after the
 * slash, etc.) so callers can fall through to user-input handling.
 */
export function parseCommandLine(input: string): ParsedCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith(SLASH)) return undefined;
  const rest = trimmed.slice(SLASH.length);
  const match = NAME.exec(rest);
  if (!match) return undefined;
  return { name: match[1], args: (match[2] ?? '').trim() };
}
