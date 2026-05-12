/**
 * Application entry point. Boots a MuRuntime via `startMu()`, registers
 * the TUI channel + Ink wiring, and starts channels.
 */

import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { AGENT_MESSAGE_TYPES, createAgentsPlugin } from 'mu-agents';
import type { ApprovalGateway, SubagentRunRegistry } from 'mu-agents';
import type { ChatMessage, Plugin, PluginContext, ProviderConfig } from 'mu-core';
import { createJSONLSessionStore, type MuRuntime, type SessionStore, startMu } from 'mu-core';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createMuToolsPlugin } from 'mu-tools';
import { parseArgs, resolveInitialSession } from '../cli/args';
import { handleSubcommand } from '../cli/subcommands';
import { loadConfig, getDataDir } from '../config/index';
import { discoverPluginFiles, loadConfiguredPlugin } from '../runtime/pluginLoader';
import { getProjectId } from '../sessions/project';
import { createTuiChannel } from '../tui/channel/tuiChannel';
import { SubagentMessage } from '../tui/components/messages/SubagentMessage';
import { createInkApprovalChannel } from '../tui/plugins/InkApprovalChannel';
import { InkUIService } from '../tui/plugins/InkUIService';
import { checkForUpdatesInBackground } from '../runtime/startupUpdateCheck';
import { createFileMentionProvider } from '../runtime/fileMentionProvider';
import { registerShutdown } from './shutdown';

interface AgentPluginShape {
  approvalGateway?: ApprovalGateway;
  runs?: SubagentRunRegistry;
}

function getProjectSessionsDir(): string {
  return join(getDataDir(), 'sessions', getProjectId());
}

async function runApp(): Promise<void> {
  if (await handleSubcommand()) return;

  const cliArgs = parseArgs();
  const config = loadConfig(cliArgs.model);
  const uiService = new InkUIService();

  const sessionsDir = getProjectSessionsDir();
  const store = createJSONLSessionStore({ dir: sessionsDir });

  // Resolve initial session: either resumed from CLI or fresh.
  const initial = resolveInitialSession(cliArgs, store);

  let runtimeRef: MuRuntime | null = null;
  const shutdown = registerShutdown(() => runtimeRef?.registry ?? null);
  const pCfg = config as ProviderConfig;

  const runtime = await startMu({
    cwd: process.cwd(),
    config: {
      baseUrl: pCfg.baseUrl,
      model: pCfg.model,
      maxTokens: pCfg.maxTokens,
      temperature: pCfg.temperature,
      streamTimeoutMs: pCfg.streamTimeoutMs,
      systemPrompt: pCfg.systemPrompt,
      plugins: config.plugins,
    },
    store,
    plugins: [
      createOpenAIProviderPlugin(),
      createAgentsPlugin({
        config: pCfg,
        model: pCfg.model,
        approvalChannelId: 'tui',
        getParentSessionPath: () => {
          // Derive from sessions dir + current session id.
          const active = runtimeRef?.sessions.list()[0];
          if (!active) return undefined;
          return join(sessionsDir, `${active.id}.jsonl`);
        },
        sessionWriter: async (path: string, messages: ChatMessage[]) => {
          await mkdir(dirname(path), { recursive: true });
          // Write subagent runs as JSONL (same format as parent sessions).
          const lines = messages.map((m) => JSON.stringify(m));
          const { writeFile } = await import('node:fs/promises');
          await writeFile(path, `${lines.join('\n')}\n`, 'utf-8');
        },
      }),
      createMuToolsPlugin(),
    ],
    resolvePlugin: async (entry: string | { name: string; config?: Record<string, unknown> }) => {
      const name = typeof entry === 'string' ? entry : entry.name;
      const pluginConfig = typeof entry === 'string' ? undefined : entry.config;
      const merged: Record<string, unknown> = pluginConfig ? { ...pluginConfig } : {};
      merged.ui = uiService;
      merged.shutdown = shutdown;
      if (!('config' in merged)) merged.config = config;
      if (!('model' in merged) && pCfg.model) merged.model = pCfg.model;
      return loadConfiguredPlugin(runtime?.registry ?? null, name, merged, uiService);
    },
  });
  runtimeRef = runtime;

  for (const filePath of discoverPluginFiles()) {
    await loadConfiguredPlugin(runtime.registry, filePath, { ui: uiService, shutdown, config }, uiService);
  }

  const agentPlugin = runtime.registry.getPlugin<Plugin & AgentPluginShape>('mu-agents');

  runtime.channels.register(
    createTuiChannel({
      config,
      initialSessionId: initial.sessionId,
      initialMessages: initial.messages,
      registry: runtime.registry,
      sessions: runtime.sessions,
      store,
      submitText: (input) => runtime.submitText(input),
      uiService,
      shutdown,
      subagentRuns: agentPlugin?.runs,
    }),
  );

  if (agentPlugin?.approvalGateway) {
    agentPlugin.approvalGateway.registerChannel('tui', createInkApprovalChannel(uiService));
  }

  await runtime.registry.register({
    name: 'mu-coding-tui',
    activate(ctx: PluginContext) {
      ctx.registerMentionProvider?.('@', createFileMentionProvider(ctx.cwd));
      if (ctx.registerMessageRenderer) {
        ctx.registerMessageRenderer(AGENT_MESSAGE_TYPES.subagent, (m: ChatMessage) => <SubagentMessage msg={m} />);
      }
    },
  });

  void checkForUpdatesInBackground(uiService);
  await runtime.start();
}

export function startApp(): void {
  runApp().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
