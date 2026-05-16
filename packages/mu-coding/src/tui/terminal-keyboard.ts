/**
 * xterm modifyOtherKeys compatibility layer.
 *
 * Ink's `kittyKeyboard` option handles enhanced keyboard reporting when the
 * terminal supports the Kitty protocol. When it does NOT (e.g. GNOME Terminal,
 * iTerm2, older xterm), we fall back to xterm's `modifyOtherKeys` mode 2 so
 * modified keys like `Shift+Enter` still produce parseable escape sequences.
 *
 * We detect Kitty support by querying the terminal with `\x1b[?u` (Kitty
 * keyboard protocol query). The terminal responds with `\x1b[?Nu` where N
 * is a flag value: 0 = not supported, 1/2 = supported.
 *
 * When Kitty IS detected, `setupTerminalKeyboard()` becomes a no-op — Ink
 * already owns the keyboard via `kittyKeyboard` and adding xterm
 * modifyOtherKeys on top causes character duplication.
 */

const ENABLE_XTERM_MODIFIED_KEYS = '\x1b[>4;2m';
const DISABLE_XTERM_MODIFIED_KEYS = '\x1b[>4;0m';
const KITTY_QUERY = '\x1b[?u';
// biome-ignore lint/complexity/useRegexLiterals: control char \x1b not allowed in literal
const KITTY_RESPONSE_RE = new RegExp('\x1b\\[\\?(\\d+)u');
const XTERM_MODIFIED_ENTER_PREFIX = '\x1b[27;';
const XTERM_MODIFIED_ENTER_RE = new RegExp(`${XTERM_MODIFIED_ENTER_PREFIX.replace('[', '\\[')}(\\d+);13~`, 'g');
const XTERM_MODIFIED_ENTER_COMPLETE_RE = new RegExp(`^${XTERM_MODIFIED_ENTER_PREFIX.replace('[', '\\[')}\\d+;13~$`);
const XTERM_MODIFIED_ENTER_PARTIAL_RE = new RegExp(`^${XTERM_MODIFIED_ENTER_PREFIX.replace('[', '\\[')}\\d*;?1?3?~?$`);

type ReadFn = (size?: number) => Buffer | string | null;

const noop = (): void => undefined;

let kittyDetected: boolean | null = null;

function normalizeModifiedEnter(input: string): string {
  return input.replace(XTERM_MODIFIED_ENTER_RE, '\x1b[13;$1u');
}

function splitCarry(input: string): { ready: string; carry: string } {
  const escapeIndex = input.lastIndexOf(XTERM_MODIFIED_ENTER_PREFIX);
  if (escapeIndex === -1) return { ready: input, carry: '' };

  const suffix = input.slice(escapeIndex);
  if (XTERM_MODIFIED_ENTER_PARTIAL_RE.test(suffix) && !XTERM_MODIFIED_ENTER_COMPLETE_RE.test(suffix)) {
    return { ready: input.slice(0, escapeIndex), carry: suffix };
  }

  return { ready: input, carry: '' };
}

/**
 * Query the terminal for Kitty keyboard protocol support. Sends `\x1b[?u`
 * and waits up to `timeoutMs` for a `\x1b[?Nu` response.
 *
 * Returns `true` if N > 0 (Kitty supported), `false` otherwise.
 *
 * Must be called BEFORE Ink takes over stdin, since it temporarily
 * attaches a `'data'` listener to capture the response.
 */
export async function probeKittyKeyboard(timeoutMs = 50): Promise<boolean> {
  if (kittyDetected !== null) return kittyDetected;

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    kittyDetected = false;
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let buf = '';

    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      process.stdin.removeListener('data', onData);
      if (!wasRaw) process.stdin.setRawMode(false);
      kittyDetected = result;
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(KITTY_RESPONSE_RE);
      if (match) {
        finish(parseInt(match[1], 10) > 0);
      }
    };

    timer = setTimeout(() => finish(false), timeoutMs);
    process.stdin.on('data', onData);
    process.stdout.write(KITTY_QUERY);
  });
}

/**
 * Enable xterm modifyOtherKeys mode 2 and patch `stdin.read` to normalize
 * modified Enter sequences into CSI-u for Ink.
 *
 * Returns a no-op cleanup function if Kitty was previously detected via
 * `probeKittyKeyboard()` — in that case Ink's `kittyKeyboard` option
 * already handles enhanced keyboard reporting and adding xterm
 * modifyOtherKeys on top would cause character duplication.
 */
export function setupTerminalKeyboard(): () => void {
  if (kittyDetected === true) return noop;

  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!(stdin.isTTY && stdout.isTTY)) return noop;

  try {
    stdout.write(ENABLE_XTERM_MODIFIED_KEYS);
  } catch {
    return noop;
  }

  let carry = '';
  const originalRead = stdin.read.bind(stdin) as ReadFn;
  const patchedRead = (size?: number): Buffer | string | null => {
    const raw = originalRead(size);
    if (raw === null) return null;

    const isString = typeof raw === 'string';
    const text = isString ? raw : raw.toString('utf8');
    const split = splitCarry(carry + text);
    carry = split.carry;
    const normalized = normalizeModifiedEnter(split.ready);

    if (isString) return normalized;
    return Buffer.from(normalized, 'utf8');
  };

  (stdin as unknown as { read: ReadFn }).read = patchedRead;

  return () => {
    const current = (stdin as unknown as { read: ReadFn }).read;
    if (current === patchedRead) {
      (stdin as unknown as { read: ReadFn }).read = originalRead;
    }
    try {
      stdout.write(DISABLE_XTERM_MODIFIED_KEYS);
    } catch {
      /* ignore terminal cleanup errors */
    }
  };
}
