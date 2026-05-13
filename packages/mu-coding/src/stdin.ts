import * as readline from 'node:readline';
import { createAgentsPlugin } from 'mu-agents';
import { Mu, type Plugin, type ProviderConfig, newMessage } from 'mu-core';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createMuToolsPlugin } from 'mu-tools';
import { createStdinApprovalChannel } from './approval';
import { getAgentsDir, getSessionsDir } from './config';
import { loadConfiguredPlugins } from './runtime/pluginLoader';
import { createUpdateCommandPlugin } from './runtime/updateCommandPlugin';
import { createJsonlStore } from './store';

const CHANNEL_ID = 'cli';

export interface StartStdinOptions {
  config: ProviderConfig;
  sessionIdOpt?: string;
}

/**
 * Headless stdin CLI used when stdout isn't a TTY (piped, CI). Bare-bones:
 * line-buffered readline, no completions, no TUI niceties. The TUI is the
 * real product; this mode exists so scripts can still pipe messages.
 */
export async function startStdinCli({ config, sessionIdOpt }: StartStdinOptions): Promise<void> {
  const userPlugins = await loadConfiguredPlugins([]); // headless: load only loose files
  const store = createJsonlStore(getSessionsDir());

  let isPaused = false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const approval = createStdinApprovalChannel({
    pause: () => {
      isPaused = true;
      rl.pause();
    },
    resume: () => {
      isPaused = false;
      rl.resume();
      if (!stopped) process.stdout.write('> ');
    },
  });

  const agents = createAgentsPlugin({ dirs: [getAgentsDir()], approval });

  const cliPlugin: Plugin = {
    name: 'mu-coding-stdin',
    register(api) {
      api.channel({
        id: CHANNEL_ID,
        async start(ctx) {
          const session = ctx.session(sessionIdOpt);
          session.on((event) => {
            if (event.type !== 'message_appended') return;
            const m = event.message;
            if (m.role === 'system' && m.content && m.meta?.visibility !== 'llm') {
              process.stdout.write(`\n${m.content}\n`);
            }
          });

          const prompt = (): void => {
            if (!stopped && !isPaused) process.stdout.write('> ');
          };

          rl.on('line', async (raw) => {
            const line = raw.trim();
            if (!line) return prompt();
            if (line.startsWith('/')) {
              const [name = '', ...rest] = line.slice(1).split(' ');
              const cmd = ctx.getCommand(name);
              if (!cmd) {
                await session.append(
                  newMessage({
                    role: 'system',
                    content: `unknown command: /${name} (try /help)`,
                    meta: { visibility: 'ui', transient: true },
                  }),
                );
                return prompt();
              }
              await cmd.execute(rest.join(' '), session);
              return prompt();
            }
            const userMsg = newMessage({ role: 'user', content: line, channelId: CHANNEL_ID });
            let last = '';
            for await (const ev of session.run({ userMessage: userMsg })) {
              if (ev.type === 'content') {
                process.stdout.write(ev.text.slice(last.length));
                last = ev.text;
              } else if (ev.type === 'turn_end') {
                if (ev.error) console.error(`\nerror: ${ev.error.message}`);
                process.stdout.write('\n');
              }
            }
            prompt();
          });

          rl.on('close', () => {
            stopped = true;
          });
          prompt();
        },
      });
    },
  };

  let stopped = false;

  const mu = await Mu.start({
    config,
    plugins: [
      createOpenAIProviderPlugin(),
      createMuToolsPlugin(),
      agents,
      store.plugin(),
      createUpdateCommandPlugin(),
      ...userPlugins,
      cliPlugin,
    ],
  });

  // Block until stdin closes.
  await new Promise<void>((resolve) => rl.on('close', () => resolve()));
  await mu.shutdown();
}
