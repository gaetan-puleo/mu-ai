import { createAgentsPlugin } from 'mu-agents';
import { Mu, type Plugin, type ProviderConfig, type Session } from 'mu-core';
import { createOpenAIProviderPlugin, listModels as listOpenAIModels } from 'mu-openai-provider';
import { createMuToolsPlugin } from 'mu-tools';
import { getAgentsDir, getSessionsDir } from './config';
import { loadConfiguredPlugins } from './runtime/pluginLoader';
import { startupUpdateCheck } from './runtime/startupUpdateCheck';
import { createUpdateCommandPlugin } from './runtime/updateCommandPlugin';
import { createJsonlStore, type SessionSummary } from './store';
import { getMuCodingTUI } from './tui/api';
import { buildTuiChannel } from './tui/channel';
import { safeDispatch } from './tui/dispatchSlot';
import { createInkApprovalChannel } from './tui/plugins/InkApprovalChannel';
import { mountTui } from './tui/renderApp';

export interface StartTuiOptions {
  config: ProviderConfig;
  sessionIdOpt?: string;
}

export async function startTui({ config, sessionIdOpt }: StartTuiOptions): Promise<void> {
  const userPlugins = await loadConfiguredPlugins([]);
  const store = createJsonlStore(getSessionsDir());

  const approval = createInkApprovalChannel();
  const agents = createAgentsPlugin({ dirs: [getAgentsDir()], approval });

  // Fetch the OpenAI-compatible model list at `GET {baseUrl}/models`. Used
  // by the `/model` slash command below. Surfaces errors / empty results as
  // toasts instead of returning `[]` silently.
  const fetchModelList = async (): Promise<string[]> => {
    try {
      const models = await listOpenAIModels(config.baseUrl);
      if (models.length === 0) {
        getMuCodingTUI()?.notify(`No models returned from ${config.baseUrl}/models`, 'warning');
      }
      return models.map((m) => m.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      getMuCodingTUI()?.notify(`Failed to list models: ${msg}`, 'error');
      return [];
    }
  };

  // The channel needs to know what session it's bound to; we build it after
  // Mu.start (so we have the Session instance) but register it via a plugin.
  let channelHandle: ReturnType<typeof buildTuiChannel> | undefined;
  const channelPlugin: Plugin = {
    name: 'mu-coding-tui',
    register(api) {
      // Channels register via the api; we provide a stub now and rebind in
      // the App once the session is known. The real submit/abort happen via
      // channelHandle.submit / abort from React.
      api.channel({
        id: 'cli',
        async start() {
          /* TUI drives input; nothing to start. */
        },
      });

      // `/model` and `/sessions` used to be inline-handled inside the
      // React submit handler, which meant they didn't show up in the
      // command picker autocomplete or in `/help`, and were unreachable
      // in stdin mode. Registering them as real commands fixes both.
      api.command({
        name: 'model',
        description: 'pick active model',
        async execute() {
          const models = await fetchModelList();
          safeDispatch({
            type: 'modal_open',
            modal: { kind: 'modelPicker', models, current: config.model },
          });
        },
      });
      api.command({
        name: 'sessions',
        description: 'switch sessions',
        async execute() {
          safeDispatch({ type: 'modal_open', modal: { kind: 'sessionList' } });
        },
      });
    },
  };

  const mu = await Mu.start({
    config,
    plugins: [
      createOpenAIProviderPlugin(),
      createMuToolsPlugin(),
      agents,
      store.plugin(),
      createUpdateCommandPlugin(),
      ...userPlugins,
      channelPlugin,
    ],
  });

  // Resolve / create session.
  let session: Session;
  if (sessionIdOpt) {
    const stored = store.load(sessionIdOpt);
    session = mu.session(sessionIdOpt, { initialMessages: stored?.messages });
  } else {
    session = mu.session();
  }

  channelHandle = buildTuiChannel(session);

  const listSessions = (): SessionSummary[] => store.list();
  const switchSession = (id: string): void => {
    const stored = store.load(id);
    const next = mu.session(id, { initialMessages: stored?.messages });
    channelHandle?.switchSession(next);
  };

  const setModel = (model: string): void => {
    // Mu reads from its frozen ProviderConfig on each session.run(), and
    // `mu._config` is the same object reference as `config` (see Mu.start),
    // so mutating here propagates to the next turn. Also push into the React
    // store so the status bar and the next picker's `current` highlight stay
    // in sync — they used to drift before this consolidation.
    config.model = model;
    safeDispatch({ type: 'set_model', model });
  };

  const commandsView = (): readonly import('mu-core').Command[] =>
    (mu as unknown as { _commands: readonly import('mu-core').Command[] })._commands;

  const tui = mountTui({
    session,
    model: config.model,
    agents: agents.handle,
    submit: (text) => channelHandle!.submit(text),
    abort: () => channelHandle!.abort(),
    commands: commandsView,
    listSessions,
    switchSession,
    setModel,
  });

  // Background update check (1h cache). Surface as a toast.
  startupUpdateCheck()
    .then((outdated) => {
      if (outdated.length === 0) return;
      // Small delay so the TUI API is set by the React effect first.
      setTimeout(() => {
        getMuCodingTUI()?.notify(
          `${outdated.length} package${outdated.length === 1 ? '' : 's'} outdated — run /update`,
          'info',
        );
      }, 100);
    })
    .catch(() => {
      /* ignored */
    });

  await tui.waitUntilExit();
  tui.unmount();
  await mu.shutdown();
}
