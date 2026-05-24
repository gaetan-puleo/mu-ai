import type { InputEvent } from './events';
import { parseInput } from './keyboard';

const ESC = '\x1b';
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export interface TerminalInputParserOptions {
  maxBufferBytes?: number;
  maxPasteBytes?: number;
}

export class TerminalInputParser {
  private buffer = '';
  private paste = '';
  private inPaste = false;

  constructor(private readonly options: TerminalInputParserOptions = {}) {}

  feed(data: string): InputEvent[] {
    this.buffer += data;
    const events: InputEvent[] = [];

    while (this.buffer.length > 0) {
      if (this.inPaste) {
        const end = this.buffer.indexOf(PASTE_END);
        if (end === -1) {
          this.paste += this.buffer;
          this.buffer = '';
          if (this.paste.length > this.maxPasteBytes) {
            events.push({ type: 'paste', text: this.paste.slice(0, this.maxPasteBytes), raw: this.paste });
            this.paste = '';
            this.inPaste = false;
          }
          break;
        }

        this.paste += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + PASTE_END.length);
        events.push({ type: 'paste', text: this.paste, raw: `${PASTE_START}${this.paste}${PASTE_END}` });
        this.paste = '';
        this.inPaste = false;
        continue;
      }

      if (this.buffer.startsWith(PASTE_START)) {
        this.buffer = this.buffer.slice(PASTE_START.length);
        this.inPaste = true;
        continue;
      }

      const token = takeToken(this.buffer);
      if (token === null) {
        if (this.buffer.length > this.maxBufferBytes) {
          events.push({
            type: 'terminalResponse',
            raw: this.buffer.slice(0, this.maxBufferBytes),
            sequence: 'unknown',
          });
          this.buffer = '';
          continue;
        }
        break;
      }

      this.buffer = this.buffer.slice(token.length);
      const event = parseInput(token);
      if (event) events.push(event);
    }

    return events;
  }

  flushPending(): InputEvent[] {
    if (this.buffer.length === 0) return [];
    const raw = this.buffer;
    this.buffer = '';
    const event = parseInput(raw);
    return event ? [event] : [{ type: 'terminalResponse', raw, sequence: 'unknown' }];
  }

  hasPendingEscape(): boolean {
    return this.buffer === ESC;
  }

  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  private get maxBufferBytes(): number {
    return this.options.maxBufferBytes ?? 64 * 1024;
  }

  private get maxPasteBytes(): number {
    return this.options.maxPasteBytes ?? 1024 * 1024;
  }
}

function takeToken(input: string): string | null {
  if (input.length === 0) return null;
  if (!input.startsWith(ESC)) return takeTextOrControl(input);
  if (input.length === 1) return null;

  const prefix = input.slice(0, 2);
  if (prefix === '\x1b[') return takeCsi(input);
  if (prefix === '\x1b]') return takeString(input, true);
  if (prefix === '\x1bP' || prefix === '\x1b_' || prefix === '\x1b^' || prefix === '\x1bX') {
    return takeString(input, false);
  }
  if (prefix === '\x1bO') return input.length >= 3 ? input.slice(0, 3) : null;

  return Array.from(input).length >= 2 ? ESC + Array.from(input.slice(1))[0] : null;
}

function takeTextOrControl(input: string): string {
  const first = input.codePointAt(0) ?? 0;
  if (first < 0x20 || first === 0x7f) return input.slice(0, first > 0xffff ? 2 : 1);

  let end = 0;
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === ESC || code < 0x20 || code === 0x7f) break;
    end += ch.length;
  }
  return input.slice(0, end);
}

function takeCsi(input: string): string | null {
  for (let i = 2; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) {
      return input.slice(0, i + 1);
    }
  }
  return null;
}

function takeString(input: string, allowBel: boolean): string | null {
  for (let i = 2; i < input.length; i++) {
    if (allowBel && input.charCodeAt(i) === 0x07) return input.slice(0, i + 1);
    if (input[i] === ESC && input[i + 1] === '\\') return input.slice(0, i + 2);
  }
  return null;
}
