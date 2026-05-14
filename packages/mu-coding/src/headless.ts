import * as readline from 'node:readline';
import {
  type Channel,
  type ChannelContext,
  type Command,
  debugLog,
  Mu,
  newMessage,
  type Plugin,
  type Session,
  type SessionEvent,
} from 'mu-core';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';

export interface RunHeadlessOptions {
  baseUrl: string;
  model?: string;
  /**
   * If true, stream reasoning deltas to stderr with a `[reasoning]` prefix.
   * Stdout remains content-only so it stays pipe-friendly.
   * Also enabled when `MU_REASONING=1` is set in the environment.
   */
  reasoning?: boolean;
}

interface HeadlessChannelOptions {
  showReasoning: boolean;
  onClosed: () => void;
}

/**
 * Headless channel: same role as TuiChannel but driven by readline. Goes
 * through `ChannelContext` for command lookup/dispatch so slash commands
 * (built-in /help, host-registered /quit /clear, and any plugin-contributed
 * command) work identically in both modes.
 */
function createHeadlessChannelPlugin(opts: HeadlessChannelOptions): Plugin {
  let rl: readline.Interface | null = null;
  let closed = false;
  let sessionRef: Session | null = null;
  let unsubscribeSession: (() => void) | null = null;

  const closeOnce = (): void => {
    if (closed) return;
    closed = true;
    try {
      rl?.close();
    } catch {
      /* readline close errors are non-fatal */
    }
    unsubscribeSession?.();
    opts.onClosed();
  };

  const writePrompt = (): void => {
    process.stdout.write('> ');
  };

  const handleLine = async (raw: string, ctx: ChannelContext): Promise<void> => {
    const line = raw.trim();
    if (!line) {
      writePrompt();
      return;
    }

    if (line.startsWith('/')) {
      const trimmed = line.slice(1);
      const spaceIdx = trimmed.search(/\s/);
      const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
      const cmd = name ? ctx.getCommand(name) : undefined;
      if (cmd) {
        try {
          await cmd.execute(args, sessionRef ?? ctx.session());
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`\ncommand /${name} failed: ${msg}\n`);
        }
        if (!closed) writePrompt();
        return;
      }
      // No matching command — fall through and treat as a normal user message
      // so users aren't surprised that "/notacmd" silently no-ops. Mirror the
      // TUI's behaviour: emit a small system note on stderr.
      process.stderr.write(`unknown command: /${name}\n`);
      if (!closed) writePrompt();
      return;
    }

    debugLog('headless', 'submit', { textLen: line.length });
    const session = sessionRef ?? ctx.session();
    const userMsg = newMessage({ role: 'user', content: line });
    let lastContentLen = 0;
    let lastWritten = 0;
    let lastReasoningLen = 0;
    let lastReasoningWritten = 0;
    let reasoningHeaderWritten = false;
    let messageLen: number | null = null;
    for await (const ev of session.run({ userMessage: userMsg })) {
      if (ev.type === 'content') {
        const delta = ev.text.slice(lastWritten);
        process.stdout.write(delta);
        lastWritten = ev.text.length;
        lastContentLen = ev.text.length;
      } else if (ev.type === 'reasoning') {
        lastReasoningLen = ev.text.length;
        if (opts.showReasoning) {
          const delta = ev.text.slice(lastReasoningWritten);
          if (delta) {
            if (!reasoningHeaderWritten) {
              process.stderr.write('[reasoning] ');
              reasoningHeaderWritten = true;
            }
            process.stderr.write(delta);
            lastReasoningWritten = ev.text.length;
          }
        }
      } else if (ev.type === 'message' && ev.message.role === 'assistant') {
        messageLen = ev.message.content.length;
        debugLog('headless', 'event.message.assistant', {
          contentLen: ev.message.content.length,
          reasoningLen: ev.message.reasoning?.length ?? 0,
          lastContentLen,
          lastReasoningLen,
        });
        if (opts.showReasoning && reasoningHeaderWritten) {
          process.stderr.write('\n');
          reasoningHeaderWritten = false;
          lastReasoningWritten = 0;
        }
      } else if (ev.type === 'turn_end') {
        debugLog('headless', 'event.turn_end', {
          reason: ev.reason,
          errorMessage: ev.error?.message,
          lastContentLen,
          lastReasoningLen,
          messageLen: messageLen ?? -1,
        });
        if (ev.error) {
          process.stderr.write(`\nerror: ${ev.error.message}\n`);
        }
        if (opts.showReasoning && reasoningHeaderWritten) {
          process.stderr.write('\n');
          reasoningHeaderWritten = false;
        }
        process.stdout.write(
          `\n[stream contentLen=${lastContentLen} reasoningLen=${lastReasoningLen} messageLen=${messageLen ?? 'none'}]\n`,
        );
      }
    }
    if (!closed) writePrompt();
  };

  const channel: Channel = {
    id: 'headless',
    async start(ctx: ChannelContext) {
      const session = ctx.session();
      sessionRef = session;

      // Mirror system messages (e.g. /help output) onto stdout so the user
      // sees command feedback in headless mode too.
      unsubscribeSession = session.on((ev: SessionEvent) => {
        if (ev.type === 'message_appended' && ev.message.role === 'system') {
          if (ev.message.content) {
            process.stdout.write(`${ev.message.content}\n`);
          }
        } else if (ev.type === 'transcript_cleared') {
          process.stdout.write('[transcript cleared]\n');
        }
      });

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      let queue: Promise<void> = Promise.resolve();
      rl.on('line', (raw) => {
        queue = queue
          .then(() => handleLine(raw, ctx))
          .catch((err) => {
            process.stderr.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`);
          });
      });
      rl.on('close', () => {
        // Drain in-flight work then signal closed.
        void queue
          .catch(() => {
            /* swallowed: errors already surfaced per-line */
          })
          .then(() => closeOnce());
      });

      writePrompt();
    },
    async stop() {
      closeOnce();
    },
  };

  const plugin: Plugin = {
    name: 'mu-coding-headless',
    register(api) {
      api.channel(channel);

      const quit: Command = {
        name: 'quit',
        description: 'Exit the REPL',
        execute() {
          closeOnce();
        },
      };
      api.command(quit);
      api.command({
        name: 'exit',
        description: 'Exit the REPL',
        execute() {
          closeOnce();
        },
      });
      api.command({
        name: 'clear',
        description: 'Clear the transcript',
        execute(_args, session) {
          session.clear();
        },
      });
    },
  };

  return plugin;
}

/**
 * Headless REPL — no Ink, just stdin/stdout. Used to isolate streaming bugs
 * from rendering bugs: if a long reply truncates here, it's NOT a TUI issue.
 *
 * Wired through mu-core's command registry via a `Channel` so that slash
 * commands (built-in /help, host-registered /quit /clear, plugin-contributed
 * commands like /repomap) all work uniformly.
 */
export async function runHeadless(opts: RunHeadlessOptions): Promise<void> {
  if (!opts.model) {
    process.stderr.write(
      'Headless mode requires a model. Pass --model <id> or set "model" in ~/.config/mu/config.json.\n',
    );
    process.exit(2);
  }

  const showReasoning = opts.reasoning === true || process.env.MU_REASONING === '1';

  await new Promise<void>((resolveClosed) => {
    let muRef: Mu | null = null;
    const headlessPlugin = createHeadlessChannelPlugin({
      showReasoning,
      onClosed: () => {
        void (async () => {
          try {
            await muRef?.shutdown();
          } finally {
            resolveClosed();
          }
        })();
      },
    });

    void Mu.start({
      config: { baseUrl: opts.baseUrl, model: opts.model },
      plugins: [createOpenAIProviderPlugin(), headlessPlugin],
    }).then((mu) => {
      muRef = mu;
    });
  });
}
