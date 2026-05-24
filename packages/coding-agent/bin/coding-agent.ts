#!/usr/bin/env -S deno run -A
import { loadPlugins } from 'mu-core';
import type { LocalBackendKind } from 'mu-local-provider';
import { createLocalProvider, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import { getConfigPath, getPluginsDir, loadConfig, loadState } from '../src/config';
import { install, uninstall } from '../src/install';
import { main } from '../src/main';
import { createAgentRuntime } from '../src/runtime';

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

  const plugins = await loadPlugins({
    localDir: getPluginsDir(),
    npmSpecs: config.plugins,
  });

  const providerPlugin = config.provider ? plugins.find((p) => p.name === config.provider) : undefined;
  if (config.provider && !providerPlugin?.provider) {
    throw new Error(
      `Provider plugin "${config.provider}" not found or does not export a provider. ` +
        `Loaded plugins: ${plugins.map((p) => p.name).join(', ') || '(none)'}`,
    );
  }

  const useLocal = !providerPlugin;

  const fetchModels = async () => {
    if (!useLocal) return [];
    return listLocalModels({ kind: config.kind as LocalBackendKind, baseUrl: config.baseUrl });
  };

  const models = await fetchModels();

  if (useLocal && models.length === 0) {
    throw new Error(`No models found at ${config.baseUrl}. Check your config or backend status.`);
  }

  const savedModel = state.model && models.some((m) => m.id === state.model) ? state.model : undefined;
  const model = useLocal ? (savedModel ?? models[0].id) : (state.model ?? '');

  const provider = useLocal
    ? createLocalProvider({ kind: config.kind as LocalBackendKind, baseUrl: config.baseUrl, model })
    : undefined;

  const tools = createMuTools();

  const agent = createAgentRuntime({
    provider,
    tools,
    plugins,
    model,
    models,
    listModels: fetchModels,
  });

  await main(agent);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
