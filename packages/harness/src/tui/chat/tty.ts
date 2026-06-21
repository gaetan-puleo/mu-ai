import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterHandle } from '../../channels/adapter';
import type { Harness } from '../../harness/types';
import { probeModelCapabilities } from '../../harness/model-loading';
import type { ApprovalManager } from '../../permissions';
import type { AgentSession } from '../../session';
import { ChatApp, type ChatFeatures, type ChatHost, type ModelInfo } from './ChatApp';

/**
 * Host-supplied agent control. The host decides how its agents are named, colored,
 * and cycled (the in-process TUI rotates through a configured primary set); the
 * adapter just surfaces the current one to the chat UI.
 */
export interface AgentControl {
  ref(): string;
  color(): string | undefined;
  cycle(): string;
  primaryNames(): string[];
}

export interface InProcessChatHostOptions {
  /** Initial session to bind; if omitted, ChatApp creates one on first message. */
  session?: AgentSession;
  /** Working directory for attachments and shell context. Defaults to harness.cwd. */
  cwd?: string;
  /** List selectable models (provider-specific, so supplied by the host). */
  listModels(): Promise<ModelInfo[]>;
  agent: AgentControl;
  /** Declared input modalities of the initial model. Both default off. */
  capabilities?: { vision?: boolean; audio?: boolean };
  voice?: ChatHost['voice'];
  initialTheme?: string;
  saveTheme?(name: string): void;
  initialThinking?: boolean;
  saveThinking?(visible: boolean): void;
  /** Persist the selected model ref when the user switches models. */
  onModelSelected?(ref: string): void;
  history?: { load(): string[]; append(text: string): void };
  banner?: string;
  minimal?: boolean;
  onExit?(code: number): void;
}

/**
 * Build a {@link ChatHost} backed directly by an in-process {@link Harness}.
 *
 * This is the in-process counterpart to the WebSocket client's `connectHarness`
 * (which reconstructs a ChatHost from wire frames): same semantic interface, no
 * serialization. Extracted here so every in-process TUI — `mu` and any other host —
 * shares one wiring instead of hand-rolling the host object.
 */
export function inProcessChatHost(
  harness: Harness,
  approvals: ApprovalManager,
  opts: InProcessChatHostOptions,
): ChatHost {
  const cwd = opts.cwd ?? harness.cwd;
  // Mutable so the model-capability probe can refine it live; ChatApp reads this
  // same object.
  const features: ChatFeatures = {
    vision: opts.capabilities?.vision === true,
    audio: opts.capabilities?.audio === true,
  };

  // In-process equivalent of the WS channel's model_loading broadcast.
  const modelLoadingListeners = new Set<(model: string, loading: boolean) => void>();
  const emitModelLoading = (model: string, loading: boolean): void => {
    for (const listener of [...modelLoadingListeners]) listener(model, loading);
  };

  return {
    session: opts.session,
    approvals,
    cwd,
    createSession: () => harness.sessions.create(),
    forkSession: (id, upToIndex) => harness.sessions.fork(id, upToIndex),
    listSessions: () => harness.sessions.list({ cwd }),
    openSession: (id) => harness.sessions.open(id),
    selectModel: (ref) => {
      opts.onModelSelected?.(ref);
      harness.models.select(ref);
      // Probe behind a spinner (loads the model) and refine vision/audio from its
      // reported modalities — mirrors the WS server's models:select handler.
      void probeModelCapabilities(harness.models, ref, {
        onLoading: emitModelLoading,
        onCapabilities: (caps) => {
          features.vision = caps.vision;
          features.audio = caps.audio;
        },
      });
    },
    subscribeModelLoading: (listener) => {
      modelLoadingListeners.add(listener);
      return () => modelLoadingListeners.delete(listener);
    },
    modelRef: () => harness.models.selected,
    listModels: opts.listModels,
    agentRef: () => opts.agent.ref(),
    agentColor: () => opts.agent.color(),
    cycleAgent: () => opts.agent.cycle(),
    agentNames: () => {
      const primary = new Set(opts.agent.primaryNames());
      return harness.agents.list().map((a) => a.name).filter((name) => name !== 'title' && !primary.has(name));
    },
    subAgents: harness.subAgents,
    dispatchSubAgent: (agent, task, parentId) => harness.dispatchSubAgent(agent, task, parentId),
    commands: () => harness.commands.list().map((c) => ({ name: c.name, description: c.description })),
    runCommand: (input, ctx) => harness.commands.run(input, { session: ctx?.session }),
    initialTheme: opts.initialTheme ?? 'dark',
    saveTheme: opts.saveTheme ?? (() => {}),
    initialThinking: opts.initialThinking ?? false,
    saveThinking: opts.saveThinking ?? (() => {}),
    history: opts.history,
    features,
    voice: opts.voice,
    banner: opts.banner,
    minimal: opts.minimal,
    onExit: opts.onExit ?? (() => {}),
  };
}

export type TtyAdapterOptions = InProcessChatHostOptions;

/**
 * The interactive terminal UI as a {@link ChannelAdapter}.
 *
 * Lets the TUI run through the same `runChannels` host as every other transport
 * (e.g. the WebSocket adapter), so "interactive" and "autonomous" are just which
 * adapters are attached. On start it builds an in-process ChatHost over the
 * adapter's harness/approvals and runs ChatApp; stop tears the app down (restoring
 * the terminal).
 */
export function ttyAdapter(opts: TtyAdapterOptions): ChannelAdapter {
  return {
    name: 'tty',
    start: async (ctx: ChannelAdapterContext): Promise<ChannelAdapterHandle> => {
      const host = inProcessChatHost(ctx.harness, ctx.approvals, opts);
      const app = new ChatApp(host);
      await app.start();
      return { stop: () => app.stop() };
    },
  };
}
