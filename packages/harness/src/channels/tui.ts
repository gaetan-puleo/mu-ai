import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Channel, ChannelContext, ChannelOutEvent } from './types';

type Writer = (chunk: string) => void;
type LineSource = AsyncIterable<string> & { close: () => void };

export interface TuiChannelOptions {
  /** Channel id (default: 'tui'). */
  id?: string;
  /** Stream of input lines. Defaults to a `node:readline` interface over stdin. */
  input?: LineSource;
  /** Write function for output. Defaults to `process.stdout.write`. */
  output?: Writer;
  /** Disable ANSI styling (default: true when output is not a TTY). */
  noColor?: boolean;
  /** Prompt printed before each user input. Default: `> `. */
  prompt?: string;
}

/**
 * Minimal line-based Channel: reads stdin one line at a time, lines starting
 * with `/` are dispatched as commands, everything else as `user_input`.
 * Renders ChannelOutEvent to stdout with optional ANSI coloring.
 *
 * No mu-tui dependency — uses node:readline + raw ANSI so harness stays
 * transport-only and any host can adopt it without pulling a TUI framework.
 */
export function createTuiChannel(options: TuiChannelOptions = {}): Channel {
  const id = options.id ?? 'tui';
  const write: Writer = options.output ?? ((chunk) => {
    process.stdout.write(chunk);
  });
  const useColor = !options.noColor && (options.output ? true : Boolean((process.stdout as { isTTY?: boolean }).isTTY));
  const prompt = options.prompt ?? '> ';
  const ansi = useColor ? realAnsi : noopAnsi;

  let readline: ReadlineInterface | undefined;
  let inputSource: LineSource | undefined;
  let stopped = false;
  let inAssistantTurn = false;

  function flushAssistantNewline(): void {
    if (inAssistantTurn) {
      write('\n');
      inAssistantTurn = false;
    }
  }

  function printPrompt(): void {
    if (stopped) return;
    write(ansi.dim(prompt));
  }

  async function readLines(source: LineSource, ctx: ChannelContext): Promise<void> {
    for await (const raw of source) {
      if (stopped) break;
      const line = raw.trim();
      if (!line) {
        printPrompt();
        continue;
      }
      if (line.startsWith('/')) {
        await ctx.deliver({ type: 'command', input: line });
      } else {
        await ctx.deliver({ type: 'user_input', text: line });
      }
    }
  }

  return {
    id,
    kind: 'tui',

    start(ctx) {
      if (options.input) {
        inputSource = options.input;
      } else {
        readline = createInterface({ input: process.stdin, output: undefined, terminal: false });
        inputSource = readlineToLineSource(readline);
      }
      printPrompt();
      void readLines(inputSource, ctx);
    },

    stop() {
      stopped = true;
      readline?.close();
      inputSource?.close();
      flushAssistantNewline();
    },

    send(event) {
      renderEvent(event, write, ansi, {
        beforeNonAssistant: flushAssistantNewline,
        markAssistantTurn: () => {
          inAssistantTurn = true;
        },
        promptAgain: printPrompt,
      });
    },
  };
}

interface RenderHooks {
  beforeNonAssistant: () => void;
  markAssistantTurn: () => void;
  promptAgain: () => void;
}

function renderEvent(event: ChannelOutEvent, write: Writer, ansi: AnsiHelpers, hooks: RenderHooks): void {
  switch (event.type) {
    case 'assistant_start':
      hooks.markAssistantTurn();
      write(ansi.bold(''));
      break;
    case 'assistant_delta':
      hooks.markAssistantTurn();
      write(event.content);
      break;
    case 'assistant_message':
      hooks.markAssistantTurn();
      // Content was already streamed via deltas in the common case; print only
      // if we missed it (non-streaming providers).
      // We can't easily tell here, so we just ensure a newline and prompt.
      write('\n');
      hooks.promptAgain();
      break;
    case 'reasoning_delta':
      hooks.markAssistantTurn();
      write(ansi.dim(event.content));
      break;
    case 'reasoning_message':
      // Already streamed via reasoning_delta in most cases; nothing to add.
      break;
    case 'tool_call':
      hooks.beforeNonAssistant();
      write(`${ansi.dim(`[tool ${event.call.name}]`)}\n`);
      break;
    case 'tool_result': {
      hooks.beforeNonAssistant();
      const preview = previewString(event.message.content, 200);
      write(`${ansi.dim('[result]')} ${preview}\n`);
      break;
    }
    case 'command_result':
      hooks.beforeNonAssistant();
      if (event.ok) {
        if (event.output !== undefined) write(`${formatOutput(event.output)}\n`);
      } else {
        write(`${ansi.red(`error: ${event.error ?? 'unknown'}`)}\n`);
      }
      hooks.promptAgain();
      break;
    case 'session_switched':
      hooks.beforeNonAssistant();
      write(`${ansi.dim(`[session ${event.sessionId}]`)}\n`);
      hooks.promptAgain();
      break;
    case 'error':
      hooks.beforeNonAssistant();
      write(`${ansi.red(`[error] ${formatError(event.error)}`)}\n`);
      hooks.promptAgain();
      break;
  }
}

function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatError(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function previewString(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function readlineToLineSource(rl: ReadlineInterface): LineSource {
  const queue: string[] = [];
  let pending: ((value: IteratorResult<string>) => void) | undefined;
  let closed = false;

  rl.on('line', (line) => {
    if (pending) {
      const resolve = pending;
      pending = undefined;
      resolve({ value: line, done: false });
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (pending) {
      const resolve = pending;
      pending = undefined;
      resolve({ value: '', done: true });
    }
  });

  return {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        next(): Promise<IteratorResult<string>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
          if (closed) return Promise.resolve({ value: '', done: true });
          return new Promise((resolve) => {
            pending = resolve;
          });
        },
      };
    },
    close() {
      rl.close();
    },
  };
}

interface AnsiHelpers {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
}

const realAnsi: AnsiHelpers = {
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
};

const noopAnsi: AnsiHelpers = {
  bold: (s) => s,
  dim: (s) => s,
  red: (s) => s,
};

/** Helper for tests: build a `LineSource` from a string array. */
export function lineSourceFrom(lines: string[]): LineSource {
  let i = 0;
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        next(): Promise<IteratorResult<string>> {
          if (closed || i >= lines.length) return Promise.resolve({ value: '', done: true });
          return Promise.resolve({ value: lines[i++], done: false });
        },
      };
    },
    close() {
      closed = true;
    },
  };
}
