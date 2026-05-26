#!/usr/bin/env -S deno run -A
import { createLocalProviderPlugin, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import {
  approvalQueueToPrompt,
  bootstrap as harnessBootstrap,
  createAgentRuntime,
  createXdgPaths,
  runSubAgent,
  type SubAgent,
} from 'mu-harness';
import { getConfigPath, loadConfig, loadState, saveState } from '../src/config';
import { install, uninstall } from '../src/install';
import { main } from '../src/main';

async function run(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
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

  const config = loadConfig();
  const state = loadState();

  if (!config.baseUrl) {
    throw new Error(
      `Missing baseUrl in config. Create ${getConfigPath()} with { "kind": "llama-swap", "baseUrl": "http://..." }`,
    );
  }

  const paths = createXdgPaths('mu');
  const projectLocal = `${process.cwd()}/.mu`;

  // Determine whether the local provider will be used (true unless a user plugin
  // provides one). We can decide later — after harness bootstrap has loaded
  // user plugins. Until then, assume local so we don't pre-fetch models.
  const initialModel = state.model ?? '';

  // Build a mutable provider config so `onModelChange` can swap models without
  // recreating the plugin (the local provider reads `config.model` lazily).
  const providerConfig: { kind?: 'llama-swap'; baseUrl: string; model: string; apiKey?: string } = {
    kind: config.kind as 'llama-swap' | undefined,
    baseUrl: config.baseUrl,
    model: initialModel,
  };

  // Active primary agent — mutable, cycled by the TUI via Tab. Restored from
  // saved state when present, otherwise defaults to the first declared primary.
  let activePrimary: SubAgent | undefined;
  // One-shot override set by `@<name>` mentions; cleared when the runtime
  // returns to idle so the next user turn uses `activePrimary` again.
  let overridePrimary: SubAgent | undefined;

  // ── Harness bootstrap — loads plugins, sub-agents, skills, permissions, etc.
  const result = await harnessBootstrap({
    hostName: 'mu',
    paths,
    extraSkillsDirs: [`${projectLocal}/skills`],
    extraAgentsDirs: [`${projectLocal}/agents`],
    extraPermissionsFiles: [`${projectLocal}/permissions.json`],
    npmPlugins: config.plugins,
    baseTools: createMuTools(),
    sessionStore: 'memory',
    // Default to permissions-file (coding-agent's traditional model). Switches
    // automatically to per-agent rules if a primary agent is defined.
    permissionSource: undefined,
    defaultPermissionDecision: 'ask',
    getActivePrimary: () => overridePrimary ?? activePrimary,
  });

  // Resolve the initial active primary from state (or first declared).
  activePrimary = result.primaryAgents.find((a) => a.name === state.activeAgent) ?? result.primaryAgents[0];

  // Decide the provider: user-supplied (via config.provider) or built-in local.
  const userProviderPlugin = config.provider
    ? result.plugins.find((p) => p.name === config.provider)
    : undefined;
  if (config.provider && !userProviderPlugin?.provider) {
    throw new Error(
      `Provider plugin "${config.provider}" not found or does not export a provider. ` +
        `Loaded plugins: ${result.plugins.map((p) => p.name).join(', ') || '(none)'}`,
    );
  }
  const useLocal = !userProviderPlugin && !result.plugins.some((p) => p.provider);
  if (useLocal) {
    result.plugins.unshift(createLocalProviderPlugin(providerConfig));
  }

  // ── Agent runtime — driven by harness, no blocking model fetch at startup.
  const agent = createAgentRuntime({
    tools: result.tools,
    plugins: result.plugins,
    hooks: result.hooks,
    systemPrompt: result.systemPrompt,
    toolFilter: result.toolFilter,
    model: initialModel,
    // Models are listed lazily (when the user opens the picker).
    listModels: useLocal
      ? () => listLocalModels({ kind: providerConfig.kind, baseUrl: providerConfig.baseUrl })
      : async () => [],
    onModelChange: (next: string) => {
      if (useLocal) providerConfig.model = next;
      state.model = next;
      try {
        saveState(state);
      } catch {
        /* ignore */
      }
    },
    store: result.store,
    bus: result.bus,
  });

  await main(agent, {
    primaryAgents: result.primaryAgents,
    getActivePrimary: () => activePrimary,
    setActivePrimary: (next) => {
      activePrimary = next;
      state.activeAgent = next.name;
      try {
        saveState(state);
      } catch {
        /* ignore */
      }
    },
    getOverridePrimary: () => overridePrimary,
    setOverridePrimary: (next) => {
      overridePrimary = next;
    },
    subAgents: result.subAgents,
    dispatchSubAgent: async (name, task, onEvent) => {
      const subAgent = result.subAgents.find((a) => a.name === name);
      if (!subAgent) return { content: '', error: `Unknown sub-agent "${name}"` };
      const run = await runSubAgent({
        subAgent,
        prompt: task,
        tools: result.tools,
        plugins: result.plugins,
        approvalPrompt: approvalQueueToPrompt(result.approvalQueue),
        onEvent,
      });
      return { content: run.content, error: run.error };
    },
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
