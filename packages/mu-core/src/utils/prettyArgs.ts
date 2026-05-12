/**
 * Pretty-print tool args for display.
 *
 * Accepts either a pre-stringified value (JSON or otherwise) or a
 * structured object. Returns a stable, possibly truncated string the
 * host can render verbatim. Hosts that want to ship the result over
 * the wire avoid making each client re-format.
 */

const DEFAULT_MAX = 600;

export function prettyToolArgs(value: unknown, maxLength: number = DEFAULT_MAX): string {
  if (value == null) return '';
  let out: string;
  if (typeof value === 'string') {
    // Try to parse + re-stringify so existing JSON strings get prettified.
    try {
      out = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      out = value;
    }
  } else {
    try {
      out = JSON.stringify(value, null, 2);
    } catch {
      out = String(value);
    }
  }
  if (out.length > maxLength) {
    return `${out.slice(0, maxLength)}…`;
  }
  return out;
}
