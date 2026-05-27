import {
  type CoreEvent,
  createBus,
  createInMemorySessionStore,
  createRuntime as createCoreRuntime,
  type EventBus,
  type Plugin,
  type Session,
  type SessionStore,
  type ToolHooks,
  type Tools,
} from 'mu-core';

export interface Model {
  id: string;
  name?: string;
  description?: string;
  ownedBy?: string;
}

export interface AgentRuntime {
  bus: EventBus<CoreEvent>;
  runtime: ReturnType<typeof createCoreRuntime>;
  store: SessionStore;
  /** Current session driving the active runtime. */
  currentSession: () => Session;
  /** Reflects the current model — always in sync with `setModel()`. */
  readonly model: string;
  /**
   * Build a fresh runtime, replacing the current one.
   *  - omit `sessionId` → creates a brand new session in the store.
   *  - pass `sessionId` → loads it from the store (throws if missing).
   */
  createRuntime: (sessionId?: string) => ReturnType<typeof createCoreRuntime>;
  listModels: () => Promise<Model[]>;
  setModel: (model: string) => void;
}

export interface AgentRuntimeConfig {
  tools?: Tools;
  plugins?: Plugin[];
  /** Forwarded to the core runtime (permission gates etc.). */
  hooks?: ToolHooks;
  /** Forwarded to the core runtime. Function form is evaluated per-turn. */
  systemPrompt?: string | (() => string | undefined | Promise<string | undefined>);
  /** Forwarded to the core runtime. Defaults to 5 inside core. */
  maxRepeatedToolCalls?: number;
  /** Forwarded to the core runtime. Filters the merged tool map per-turn. */
  toolFilter?: (tools: Tools) => Tools;
  model?: string;
  listModels?: () => Promise<Model[]>;
  onModelChange?: (model: string) => void;
  /** Provide an existing store to share sessions across components. Defaults to a fresh in-memory store. */
  store?: SessionStore;
  /** Reuse an existing bus instead of creating a new one. */
  bus?: EventBus<CoreEvent>;
}

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
  const plugins = config.plugins ?? [];
  let currentModel = config.model ?? '';

  const bus = config.bus ?? createBus<CoreEvent>();
  const store = config.store ?? createInMemorySessionStore();
  let activeSession = store.create();

  const buildRuntime = (session: Session): ReturnType<typeof createCoreRuntime> =>
    createCoreRuntime({
      tools: config.tools,
      plugins,
      bus,
      session,
      hooks: config.hooks,
      systemPrompt: config.systemPrompt,
      maxRepeatedToolCalls: config.maxRepeatedToolCalls,
      toolFilter: config.toolFilter,
    });

  const createRuntime = (sessionId?: string): ReturnType<typeof createCoreRuntime> => {
    if (sessionId) {
      const existing = store.get(sessionId);
      if (!existing) throw new Error(`Unknown session "${sessionId}"`);
      activeSession = existing;
    } else {
      activeSession = store.create();
    }
    return buildRuntime(activeSession);
  };
  const runtime = buildRuntime(activeSession);

  const listModels = config.listModels ?? (async () => []);

  return {
    bus,
    runtime,
    store,
    currentSession: () => activeSession,
    get model() {
      return currentModel;
    },
    createRuntime,
    listModels,
    setModel: (nextModel: string) => {
      currentModel = nextModel;
      config.onModelChange?.(nextModel);
    },
  };
}
