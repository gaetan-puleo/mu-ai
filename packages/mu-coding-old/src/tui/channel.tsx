import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import type { AgentsHandle } from 'mu-agents';
import { type Channel, type ChannelContext, type Command, newMessage, type Plugin, type PluginAPI } from 'mu-core';
import type { LocalServerInfo } from 'mu-local-provider';
import { attachAutoPersist } from '../sessionStore/attachAutoPersist';
import { readSession, type SessionFileSummary } from '../sessionStore/jsonl';
import { sessionFilePath } from '../sessionStore/paths';
import {
  BASH_BRIDGE,
  EXIT_BRIDGE,
  MODEL_PICKER_BRIDGE,
  NEW_SESSION_BRIDGE,
  QUIT_BRIDGE,
  SESSIONS_BRIDGE,
} from './bridges';
import { Chat } from './Chat';
import { Screen } from './primitives';
import { drainStdin } from './stdin-drain';
import { setupTerminalKeyboard } from './terminal-keyboard';

export interface TuiChannelOptions {
  baseUrl: string;
  model: string;
  serverInfo: LocalServerInfo;
  agentsHandle?: AgentsHandle | undefined;
  onClosed: () => void;
}

export function createTuiChannelPlugin(opts: TuiChannelOptions): Plugin {
  let unmountInk: (() => void) | null = null;
  let waitForInkExit: Promise<void> = Promise.resolve();
  let cleanupTerminalKeyboard: (() => void) | null = null;
  let exitRequested = false;
  let notified = false;
  let detachPersist: (() => void) | null = null;
  let pluginApi: PluginAPI | null = null;

  const requestClose = (): void => {
    if (exitRequested) return;
    exitRequested = true;

    void (async () => {
      try {
        await drainStdin({ maxMs: 200, idleMs: 30 });
      } catch {
        /* drain errors are non-fatal */
      }
      try {
        process.stdin.pause();
      } catch {
        /* pause errors are non-fatal */
      }
      const inkExit = EXIT_BRIDGE.fn;
      if (inkExit) {
        try {
          inkExit();
        } catch {
          /* Ink exit errors are non-fatal — fall through to the safety net */
        }
      }
    })();

    setTimeout(() => {
      if (notified) return;
      try {
        unmountInk?.();
      } catch {
        /* unmount errors are non-fatal */
      }
      if (!notified) {
        notified = true;
        opts.onClosed();
      }
    }, 500).unref();
  };

  const persistSession = async (
    session: ReturnType<ChannelContext['session']>,
    options: { resumeExisting: boolean },
  ): Promise<void> => {
    detachPersist?.();
    detachPersist = null;
    try {
      const off = await attachAutoPersist(session, {
        header: {
          id: session.id,
          createdAt: session.createdAt,
          cwd: process.cwd(),
          model: opts.model,
          baseUrl: opts.baseUrl,
          source: 'mu-coding',
        },
        filePath: sessionFilePath(session.id),
        resumeExisting: options.resumeExisting,
      });
      detachPersist = off;
    } catch (err) {
      process.stderr.write(
        `[mu] persistence disabled for session ${session.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };

  const channel: Channel = {
    id: 'tui',
    async start(ctx: ChannelContext) {
      const initialSession = ctx.session();
      await persistSession(initialSession, { resumeExisting: false });

      const onNewSession = async (): Promise<string> => {
        const fresh = ctx.session();
        await persistSession(fresh, { resumeExisting: false });
        return fresh.id;
      };

      const onResumeSession = async (summary: SessionFileSummary): Promise<string> => {
        if (!pluginApi) throw new Error('plugin api not yet captured');
        const loaded = await readSession(summary.path);
        const session = pluginApi.createSession({
          id: summary.id,
          initialMessages: loaded.messages,
        });
        await persistSession(session, { resumeExisting: true });
        return session.id;
      };

      cleanupTerminalKeyboard = setupTerminalKeyboard();

      const instance = render(
        <Screen>
          <Chat
            ctx={ctx}
            baseUrl={opts.baseUrl}
            serverInfo={opts.serverInfo}
            initialSessionId={initialSession.id}
            agentsHandle={opts.agentsHandle}
            onNewSession={onNewSession}
            onResumeSession={onResumeSession}
            onExit={requestClose}
          />
        </Screen>,
        {
          exitOnCtrlC: false,
          alternateScreen: true,
          kittyKeyboard: {
            mode: 'disabled',
          },
        },
      );
      unmountInk = instance.unmount;
      waitForInkExit = instance.waitUntilExit().then(
        () => {
          cleanupTerminalKeyboard?.();
          if (!notified) {
            notified = true;
            opts.onClosed();
          }
        },
        () => {
          cleanupTerminalKeyboard?.();
          if (!notified) {
            notified = true;
            opts.onClosed();
          }
        },
      );
    },
    async stop() {
      detachPersist?.();
      detachPersist = null;
      requestClose();
      await waitForInkExit;
    },
  };

  const plugin: Plugin = {
    name: 'mu-coding-tui',
    register(api) {
      pluginApi = api;
      api.channel(channel);

      BASH_BRIDGE.run = async (cmd, signal) => {
        const tool = api.getTool('bash');
        if (!tool) {
          return { content: 'bash tool not registered', error: true };
        }
        const result = await tool.execute({ cmd }, signal);
        return { content: result.content, error: result.error === true };
      };

      const quitNow = (): void => {
        const fn = QUIT_BRIDGE.fn;
        if (fn) {
          fn();
          return;
        }
        process.exit(0);
      };
      const quit: Command = {
        name: 'quit',
        description: 'Exit the TUI',
        execute() {
          quitNow();
        },
      };
      api.command(quit);
      api.command({
        name: 'new',
        description: 'Start a new conversation (the previous one is saved)',
        execute() {
          const fn = NEW_SESSION_BRIDGE.fn;
          if (fn) void fn();
        },
      });
      api.command({
        name: 'sessions',
        description: 'List and resume saved sessions',
        execute() {
          SESSIONS_BRIDGE.fn?.();
        },
      });
      api.command({
        name: 'model',
        description: 'Switch the active model (opens picker)',
        execute() {
          MODEL_PICKER_BRIDGE.fn?.();
        },
      });
      api.command({
        name: 'dump-context',
        description: 'Dump the full LLM context (system prompt, messages, tools) to a JSON file',
        async execute(_args, session) {
          try {
            const payload = await session.dumpContext();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `mu-context-${session.id}-${timestamp}.json`;
            const filepath = join(process.cwd(), filename);
            writeFileSync(filepath, JSON.stringify(payload, null, 2));
            await session.append(
              newMessage({
                role: 'system',
                content: `Context dumped to ${filepath}`,
                meta: { source: 'mu-coding', visibility: 'ui', transient: true },
              }),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await session.append(
              newMessage({
                role: 'system',
                content: `Failed to dump context: ${msg}`,
                meta: { source: 'mu-coding', visibility: 'ui', transient: true },
              }),
            );
          }
        },
      });
    },
  };

  return plugin;
}
