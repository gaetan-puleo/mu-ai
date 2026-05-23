import { type CoreEvent, createBus, createRuntime as createCoreRuntime } from 'mu-core';
import type { LocalModel, LocalProviderConfig } from 'mu-local-provider';
import { createLocalProvider, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';

export interface AgentRuntime {
  bus: ReturnType<typeof createBus<CoreEvent>>;
  runtime: ReturnType<typeof createCoreRuntime>;
  model: string;
  models: LocalModel[];
  createRuntime: () => ReturnType<typeof createCoreRuntime>;
  listModels: () => Promise<LocalModel[]>;
  getModel: () => string;
  setModel: (model: string) => void;
}

export async function createAgentRuntime(config: {
  kind?: string;
  baseUrl?: string;
  model?: string;
  onModelChange?: (model: string) => void;
}): Promise<AgentRuntime> {
  const providerConfig: LocalProviderConfig = {
    kind: config.kind as LocalProviderConfig['kind'],
    baseUrl: config.baseUrl ?? 'http://localhost:8080',
    model: '',
  };

  async function fetchModels(): Promise<LocalModel[]> {
    return listLocalModels({
      kind: providerConfig.kind,
      baseUrl: providerConfig.baseUrl,
    });
  }

  const models = await fetchModels();

  if (models.length === 0) {
    throw new Error(`No models found at ${providerConfig.baseUrl}. Check your config or backend status.`);
  }

  const savedModel =
    config.model && models.some((availableModel) => availableModel.id === config.model) ? config.model : undefined;
  const model = savedModel ?? models[0].id;
  providerConfig.model = model;

  const bus = createBus<CoreEvent>();
  const provider = createLocalProvider(providerConfig);
  const tools = createMuTools({ restrictToCwd: false });
  const createRuntime = (): ReturnType<typeof createCoreRuntime> => createCoreRuntime({ provider, tools, bus });
  const runtime = createRuntime();

  return {
    bus,
    runtime,
    model,
    models,
    createRuntime,
    listModels: fetchModels,
    getModel: () => providerConfig.model ?? '',
    setModel: (nextModel: string) => {
      providerConfig.model = nextModel;
      config.onModelChange?.(nextModel);
    },
  };
}
