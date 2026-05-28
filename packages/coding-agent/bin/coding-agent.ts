#!/usr/bin/env -S deno run -A
import { createLocalProviderPlugin, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import {
  bootstrap as harnessBootstrap,
  createAgentRuntime,
  createJsonlSessionStore,
  createPrimaryAgentState,
  createResumingStore,
  createXdgPaths,
  type PersistedSessionStore,
  pickProviderPlugin,
} from 'mu-harness';
import { getConfigPath, loadConfig, loadState, saveState } from '../src/config';
import { install, uninstall } from '../src/install';
import { main } from '../src/main';

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const [cmd, arg] = args;
  if (cmd === 'install') {
    if (!arg) throw new Error('usage: mu install <npm:spec | path.ts>');
    await install(arg);
    return;
  }
  if (cmd === 'uninstall') {
    if (!arg) throw new Error('usage: mu uninstall <npm:spec>');
    uninstall(arg);
    return;
  }

  const wantContinue = args.includes('-c') || args.includes('--continue');

  const config = loadConfig();
  const state = loadState();

  if (!config.baseUrl) {
    throw new Error(
      `Missing baseUrl in config. Create ${getConfigPath()} with { "kind": "llama-swap", "baseUrl": "http://..." }`,
    );
  }

  const paths = createXdgPaths('mu');
  const projectLocal = `${process.cwd()}/.mu`;

  // ── Single state writer ───────────────────────────────────────────────
  // All `state` mutations go through this helper. `main.ts` no longer loads
  // or saves state of its own — otherwise two writers (each with their own
  // in-memory copy) would silently clobber each other on flush.
  const persistState = (): void => {
    try {
      saveState(state);
    } catch {
      /* ignore */
    }
  };

  const initialModel = state.model ?? '';

  // Mutable provider config so `onModelChange` can swap models without
  // recreating the plugin (the local provider reads `config.model` lazily).
  const providerConfig: { kind?: 'llama-swap'; baseUrl: string; model: string; apiKey?: string } = {
    kind: config.kind as 'llama-swap' | undefined,
    baseUrl: config.baseUrl,
    model: initialModel,
  };

  // ── Session store ─────────────────────────────────────────────────────
  const baseStore = createJsonlSessionStore(paths.sessionsDir);
  let resumeId: string | undefined;
  if (wantContinue) {
    resumeId = baseStore.summaries()[0]?.id;
    if (!resumeId) {
      process.stderr.write('[coding-agent] no previous session to resume; starting a new one\n');
    }
  }
  const store: PersistedSessionStore = resumeId ? createResumingStore(baseStore, resumeId) : baseStore;

  // ── Primary-agent state (active + one-shot override) ──────────────────
  // bootstrap needs `getActivePrimary` before `primaryAgents` exist, so the
  // state lives behind a ref that bootstrap reads lazily.
  const primaryRef: { state?: ReturnType<typeof createPrimaryAgentState> } = {};

  const result = await harnessBootstrap({
    hostName: 'mu',
    paths,
    extraSkillsDirs: [`${projectLocal}/skills`],
    extraAgentsDirs: [`${projectLocal}/agents`],
    extraPermissionsFiles: [`${projectLocal}/permissions.json`],
    npmPlugins: config.plugins,
    baseTools: createMuTools(),
    sessionStore: store,
    permissionSource: undefined,
    defaultPermissionDecision: 'ask',
    getActivePrimary: () => primaryRef.state?.effective(),
  });

  primaryRef.state = createPrimaryAgentState({
    agents: result.primaryAgents,
    initialName: state.activeAgent,
    onActiveChange: (name) => {
      state.activeAgent = name;
      persistState();
    },
  });
  const primaryState = primaryRef.state;

  pickProviderPlugin({
    plugins: result.plugins,
    requestedName: config.provider,
    fallback: createLocalProviderPlugin(providerConfig),
  });
  const useLocal = !config.provider;

  const agent = createAgentRuntime({
    tools: result.tools,
    plugins: result.plugins,
    hooks: result.hooks,
    systemPrompt: result.systemPrompt,
    toolFilter: result.toolFilter,
    model: initialModel,
    listModels: useLocal
      ? () => listLocalModels({ kind: providerConfig.kind, baseUrl: providerConfig.baseUrl })
      : async () => [],
    onModelChange: (next: string) => {
      if (useLocal) providerConfig.model = next;
      state.model = next;
      persistState();
    },
    store: result.store,
    bus: result.bus,
  });

  // Auto-rebinds to the active session whenever `/new` creates one.
  baseStore.persistFollowingBus(agent.bus, agent.currentSession().id);

  await main(agent, {
    thinkingVisible: state.thinkingVisible,
    onThinkingVisibleChange: (visible) => {
      state.thinkingVisible = visible;
      persistState();
    },
    primaryAgents: result.primaryAgents,
    getActivePrimary: () => primaryState.active(),
    setActivePrimary: (next) => primaryState.setActive(next.name),
    getOverridePrimary: () => primaryState.override(),
    setOverridePrimary: (next) => primaryState.setOverride(next),
    subAgents: result.subAgents,
    dispatchSubAgent: result.dispatchSubAgent,
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
