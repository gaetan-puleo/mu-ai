import {
  type CoreEvent,
  createBus,
  createRuntime as createCoreRuntime,
  type Plugin,
  type Tools,
} from 'mu-core';

export interface Model {
  id: string;
  name?: string;
  description?: string;
  ownedBy?: string;
}

export interface AgentRuntime {
  bus: ReturnType<typeof createBus<CoreEvent>>;
  runtime: ReturnType<typeof createCoreRuntime>;
  model: string;
  models: Model[];
  plugins: Plugin[];
  createRuntime: () => ReturnType<typeof createCoreRuntime>;
  listModels: () => Promise<Model[]>;
  getModel: () => string;
  setModel: (model: string) => void;
}

export interface AgentRuntimeConfig {
  tools?: Tools;
  plugins?: Plugin[];
  model?: string;
  models?: Model[];
  listModels?: () => Promise<Model[]>;
  onModelChange?: (model: string) => void;
}

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
  const { plugins = [], models: initialModels = [] } = config;
  const model = config.model ?? initialModels[0]?.id ?? '';
  let currentModel = model;

  const bus = createBus<CoreEvent>();

  const createRuntime = (): ReturnType<typeof createCoreRuntime> =>
    createCoreRuntime({ tools: config.tools, plugins, bus });
  const runtime = createRuntime();

  const listModels = config.listModels ?? (async () => initialModels);

  return {
    bus,
    runtime,
    model,
    models: initialModels,
    plugins,
    createRuntime,
    listModels,
    getModel: () => currentModel,
    setModel: (nextModel: string) => {
      currentModel = nextModel;
      config.onModelChange?.(nextModel);
    },
  };
}
