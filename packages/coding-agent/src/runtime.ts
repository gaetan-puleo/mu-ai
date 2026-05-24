import { type CoreEvent, createBus, createRuntime as createCoreRuntime, loadPlugins, type Plugin } from 'mu-core';
import type { LocalModel, LocalProviderConfig } from 'mu-local-provider';
import { createLocalProvider, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import { getPluginsDir } from './config';

export interface AgentRuntime {
  bus: ReturnType<typeof createBus<CoreEvent>>;
  runtime: ReturnType<typeof createCoreRuntime>;
  model: string;
  models: LocalModel[];
  plugins: Plugin[];
  createRuntime: () => ReturnType<typeof createCoreRuntime>;
  listModels: () => Promise<LocalModel[]>;
  getModel: () => string;
  setModel: (model: string) => void;
}

export async function createAgentRuntime(config: {
  kind?: string;
  baseUrl?: string;
  model?: string;
  plugins?: string[];
  provider?: string;
  onModelChange?: (model: string) => void;
}): Promise<AgentRuntime> {
  const providerConfig: LocalProviderConfig = {
    kind: config.kind as LocalProviderConfig['kind'],
    baseUrl: config.baseUrl ?? 'http://localhost:8080',
    model: '',
  };

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
  const nonProviderPlugins = providerPlugin ? plugins.filter((p) => p !== providerPlugin) : plugins;

  async function fetchModels(): Promise<LocalModel[]> {
    if (!useLocal) return [];
    return listLocalModels({
      kind: providerConfig.kind,
      baseUrl: providerConfig.baseUrl,
    });
  }

  const models = await fetchModels();

  if (useLocal && models.length === 0) {
    throw new Error(`No models found at ${providerConfig.baseUrl}. Check your config or backend status.`);
  }

  const savedModel = config.model && models.some((availableModel) => availableModel.id === config.model)
    ? config.model
    : undefined;
  const model = useLocal ? (savedModel ?? models[0].id) : (config.model ?? '');
  providerConfig.model = model;

  const bus = createBus<CoreEvent>();
  const provider = useLocal ? createLocalProvider(providerConfig) : undefined;
  const tools = createMuTools({ restrictToCwd: false });
  const createRuntime = (): ReturnType<typeof createCoreRuntime> =>
    createCoreRuntime({ provider, tools, plugins, bus });
  const runtime = createRuntime();

  return {
    bus,
    runtime,
    model,
    models,
    plugins,
    createRuntime,
    listModels: fetchModels,
    getModel: () => providerConfig.model ?? '',
    setModel: (nextModel: string) => {
      providerConfig.model = nextModel;
      config.onModelChange?.(nextModel);
    },
  };
}
