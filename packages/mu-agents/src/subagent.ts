import type { ChatMessage, MessageBus, ProviderConfig, ToolCall } from 'mu-core';
import { type LifecycleHooks, type PluginRegistry, type PluginRegistryView, type PluginTool, runAgent } from 'mu-core';
import type { ApprovalGateway } from './approval';
import type { AgentManager } from './manager';
import { enforceAgentPermissions } from './permissionGate';
import { AGENT_MESSAGE_TYPES } from './renderers';
import type { SubagentRunRegistry } from './subagentRun';
import type { AgentDefinition } from './types';

/**
 * `runAgent` requires a full `PluginRegistry`, but the agent plugin only
 * receives a read-only `PluginRegistryView` through its context. Build a
 * thin shim that exposes just the surface `runAgent` reaches for, with the
 * subagent's tool whitelist baked in and a single permission-enforcing
 * hook injected (so `ask` rules from the subagent's `permissions` map
 * trigger the host approval channel).
 */
function shimRegistry(view: PluginRegistryView, agent: AgentDefinition, hooks: LifecycleHooks[]): PluginRegistry {
  const allowed = new Set(agent.tools);
  const allowAll = allowed.has('*');

  const filtered = async (): Promise<PluginTool[]> => {
    const tools = view.getTools();
    return allowAll ? tools : tools.filter((t) => allowed.has(t.definition.function.name));
  };

  // Build a stub that satisfies `runAgent`'s registry-shaped contract. We
  // cast through `unknown` because we don't want to import the full
  // `PluginRegistry` class implementation just to satisfy structural typing.
  const stub = {
    getTools: () => view.getTools(),
    getFilteredTools: filtered,
    getHooks: () => hooks,
    getSystemPrompts: async () => [],
    applySystemPromptTransforms: async (prompt: string) => prompt,
    getAgentLoop: () => undefined,
    // Forward provider lookups so `runAgent`'s `streamChatViaRegistry` can
    // resolve the configured provider. Without this the nested run throws
    // "No provider registered" the moment the subagent loop tries to stream.
    getProviders: () => view.getProviders(),
  };
  return stub as unknown as PluginRegistry;
}

interface SubagentResult {
  /**
   * Wrapped output: `[Output from "<name>" subagent …]\n\n${raw}\n\n[End …]`.
   * Used by the LLM-driven `subagent` tool's return value so the parent
   * agent receives the attribution + relay-and-continue footer.
   */
  content: string;
  /**
   * Unwrapped final assistant content from the subagent run (no header /
   * footer wrapper). Used by the `@`-mention dispatch path to build a
   * single hidden relay-context user message — keeps the LLM payload from
   * carrying the same body twice.
   */
  raw: string;
  /** Run id allocated by the registry; lets callers correlate persisted state. */
  runId: string;
  error: boolean;
}

export interface RunSubagentDeps {
  agent: AgentDefinition;
  task: string;
  config: ProviderConfig;
  model: string;
  registry: PluginRegistryView;
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  runRegistry: SubagentRunRegistry;
  /** Bus used to emit the live `↳ subagent` header into the parent transcript. */
  messageBus?: MessageBus | null;
  /**
   * Resolves the on-disk transcript path for this run. Called once at
   * dispatch time; returning `undefined` keeps the run in memory only.
   */
  resolveSessionPath?: (runId: string) => string | undefined;
  /**
   * How to surface the live `↳ subagent` header. `'append'` (default)
   * writes to the bus immediately for live UX during a tool-driven
   * dispatch; `'injectNext'` queues for the next turn so the
   * `@`-mention path can keep the user's own message on top.
   */
  headerVia?: 'append' | 'injectNext';
  signal?: AbortSignal;
}

function newRunId(): string {
  return `sa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `via='append'` (default): writes to `session.messages` immediately so the
 * SubagentMessage shows "running…" live during the run. Used by the
 * LLM-driven `subagent` / `subagent_parallel` tool path, where the user
 * message is already on screen and live feedback is the right UX.
 *
 * `via='injectNext'`: queues the header for the next turn. Used by the
 * `@`-mention dispatch path so the header lands AFTER the user's own
 * message (which `session.runTurn` pushes first, then drains the queue).
 * The cost is no live "running…" feedback during the await — the header
 * appears once everything else lands together.
 */
function emitHeader(
  messageBus: MessageBus | null | undefined,
  agent: AgentDefinition,
  task: string,
  runId: string,
  via: 'append' | 'injectNext' = 'append',
): void {
  if (!messageBus) return;
  const message = {
    role: 'assistant' as const,
    content: task,
    customType: AGENT_MESSAGE_TYPES.subagent,
    display: {
      badge: agent.name,
      color: agent.color,
      // UI-only: the SubagentMessage renderer reads this to show live status,
      // but the parent LLM must NOT see a phantom assistant message between
      // the user's @-mention and the synthetic tool_call we inject in the
      // @-mention dispatch path. `llmHidden: true` strips it at the very last
      // step before the network call (see `agent.ts:streamTurn`).
      llmHidden: true,
    },
    meta: {
      agent: agent.name,
      subagentRunId: runId,
    },
  };
  if (via === 'injectNext') {
    messageBus.injectNext(message);
  } else {
    messageBus.append(message);
  }
}

/**
 * Run a subagent through the same `runAgent` loop as the host.
 *
 * The subagent's system prompt is injected as `messages[0]` so it doesn't
 * leak into the parent agent's prompt accumulator. Tool filtering is
 * enforced via the shimmed registry; `ask` permission rules flow through
 * the host approval channel so the user sees a single dialog UX whether
 * the prompt came from the parent or a nested run.
 *
 * Streaming events are mirrored into the run registry so the parent
 * transcript header and the subagent browser panel can subscribe to live
 * progress without polling.
 */
export async function runSubagent(deps: RunSubagentDeps): Promise<SubagentResult> {
  const { agent, task, config, model, registry, approvalGateway, approvalChannelId, runRegistry } = deps;

  const initialMessages: ChatMessage[] = [
    { role: 'system', content: agent.systemPrompt },
    { role: 'user', content: task },
  ];

  // Bind a fresh AbortController to the run so the user can cancel from
  // the browser panel; we still link it to a parent signal when one is
  // supplied so Esc-on-parent cascades.
  const controller = new AbortController();
  if (deps.signal) {
    if (deps.signal.aborted) controller.abort();
    else deps.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const runId = newRunId();
  const sessionPath = deps.resolveSessionPath?.(runId);
  emitHeader(deps.messageBus, agent, task, runId, deps.headerVia ?? 'append');

  const { update, finish } = runRegistry.start({
    id: runId,
    agent,
    task,
    initialMessages,
    sessionPath,
    abort: () => controller.abort(),
  });

  // Build the permission-enforcing hook for this specific subagent. The
  // hook closes over `agent`, so swapping subagents per call is safe.
  const permissionHook: LifecycleHooks = {
    beforeToolExec: async (call: ToolCall) =>
      enforceAgentPermissions({
        agent,
        registry,
        approvalGateway,
        approvalChannelId,
        call,
      }),
  };

  const subRegistry = shimRegistry(registry, agent, [permissionHook]);

  let last = '';
  try {
    for await (const event of runAgent(initialMessages, config, model, controller.signal, subRegistry)) {
      if (event.type === 'messages') {
        // event.messages is the full transcript including system+user.
        // Mirror it directly so the browser/header sees every nested turn.
        update({ messages: event.messages });
        const final = event.messages[event.messages.length - 1];
        if (final?.role === 'assistant' && final.content) last = final.content;
      }
    }
  } catch (err) {
    return finalizeError(agent, err, finish, runId);
  }
  return finalizeRun({ agent, last, controller, finish, runId });
}

/**
 * Build the failure-path SubagentResult. Centralises the run-registry
 * `finish({ status: 'error', … })` call alongside the matching return
 * payload so the catch site in `runSubagent` stays one line.
 */
async function finalizeError(
  agent: AgentDefinition,
  err: unknown,
  finish: (patch: Parameters<ReturnType<SubagentRunRegistry['start']>['finish']>[0]) => Promise<void>,
  runId: string,
): Promise<SubagentResult> {
  const message = err instanceof Error ? err.message : 'unknown';
  const failure = `Subagent '${agent.name}' failed: ${message}`;
  await finish({ status: 'error', error: message, finalContent: failure });
  return { content: failure, raw: failure, runId, error: true };
}

/**
 * Build the post-loop SubagentResult: aborted / no-output / success. The
 * success branch wraps `last` with the attribution header + relay footer
 * so the LLM-driven `subagent` tool's caller sees attribution + the
 * "relay and continue" instruction in its tool result. The unwrapped
 * `last` is exposed as `raw` for the @-mention dispatch path, which
 * builds its own (shorter) relay prompt around it.
 */
async function finalizeRun(args: {
  agent: AgentDefinition;
  last: string;
  controller: AbortController;
  finish: (patch: Parameters<ReturnType<SubagentRunRegistry['start']>['finish']>[0]) => Promise<void>;
  runId: string;
}): Promise<SubagentResult> {
  const { agent, last, controller, finish, runId } = args;
  if (controller.signal.aborted) {
    await finish({ status: 'aborted', finalContent: last || undefined });
    const aborted = last || `Subagent '${agent.name}' was aborted.`;
    return { content: aborted, raw: aborted, runId, error: true };
  }
  if (!last) {
    await finish({ status: 'error', finalContent: '', error: 'no output' });
    const noOutput = `Subagent '${agent.name}' produced no output.`;
    return { content: noOutput, raw: noOutput, runId, error: true };
  }
  await finish({ status: 'done', finalContent: last });
  const header = `[Output from "${agent.name}" subagent — quote findings as theirs, not yours]`;
  const footer =
    `[End of "${agent.name}" subagent output — relay these findings to the user (attributing them to the ${agent.name} subagent), ` +
    "then continue working on the user's original task. Take the next concrete step now — call another tool, dispatch another subagent, or make the edit required. " +
    'Do not stop after a brief summary unless the original task is fully complete.]';
  return { content: `${header}\n\n${last}\n\n${footer}`, raw: last, runId, error: false };
}

interface SubagentToolDeps {
  manager: AgentManager;
  config: ProviderConfig;
  modelRef: { current: string };
  registryRef: { current: PluginRegistryView | null };
  approvalGateway: ApprovalGateway;
  approvalChannelId: string;
  runRegistry: SubagentRunRegistry;
  messageBusRef: { current: MessageBus | null };
  resolveSessionPath?: (runId: string) => string | undefined;
}

/** Build the `subagent` tool: run a single subagent with a task. */
export function createSubagentTool(deps: SubagentToolDeps): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'subagent',
        description:
          "Dispatch a subagent for an isolated task. The subagent has its own system prompt and tool whitelist. Output is returned as text prefixed with an attribution header; quote findings as the named subagent's work, not your own.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Subagent name (e.g. "review")' },
            task: { type: 'string', description: 'Task / question for the subagent' },
          },
          required: ['name', 'task'],
          additionalProperties: false,
        },
      },
    },
    display: { verb: 'dispatching', kind: 'subagent', fields: { name: 'name', task: 'task' } },
    async execute(args, signal) {
      const name = String(args.name ?? '');
      const task = String(args.task ?? '');
      const agent = deps.manager.getSubagent(name);
      if (!agent) return { content: `subagent '${name}' not found`, error: true };
      if (!deps.registryRef.current) return { content: 'registry not ready', error: true };
      return runSubagent({
        agent,
        task,
        config: deps.config,
        model: deps.modelRef.current,
        registry: deps.registryRef.current,
        approvalGateway: deps.approvalGateway,
        approvalChannelId: deps.approvalChannelId,
        runRegistry: deps.runRegistry,
        messageBus: deps.messageBusRef.current,
        resolveSessionPath: deps.resolveSessionPath,
        signal,
      });
    },
  };
}

/** Build the `subagent_parallel` tool: fan out N subagents concurrently. */
export function createSubagentParallelTool(deps: SubagentToolDeps): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'subagent_parallel',
        description:
          'Run multiple subagents in parallel. Each entry runs independently. Results are concatenated in input order, each block prefixed with `## <name>` — preserve that attribution when reporting back to the user.',
        parameters: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              description: 'List of subagent invocations',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  task: { type: 'string' },
                },
                required: ['name', 'task'],
                additionalProperties: false,
              },
            },
          },
          required: ['calls'],
          additionalProperties: false,
        },
      },
    },
    display: { verb: 'fanning out', kind: 'subagent', fields: { count: 'calls' } },
    async execute(args, signal) {
      const calls = (args.calls as Array<{ name: string; task: string }>) ?? [];
      if (calls.length === 0) return { content: 'No calls provided', error: true };
      const results = await Promise.all(calls.map(async (call) => runOneCall(call, deps, signal)));
      // Aggregate error if every call failed; partial failures are reported
      // inline (each block keeps its `error` flag visible to the LLM through
      // the `## name` header) but the parent tool result reports success so
      // the parent agent can still consume the partial output.
      const allFailed = results.every((r) => r.error);
      return {
        content: results.map((r) => r.block).join('\n\n---\n\n'),
        error: allFailed,
      };
    },
  };
}

interface ParallelOutcome {
  block: string;
  error: boolean;
}

async function runOneCall(
  call: { name: string; task: string },
  deps: SubagentToolDeps,
  signal: AbortSignal | undefined,
): Promise<ParallelOutcome> {
  const agent = deps.manager.getSubagent(call.name);
  if (!agent) return { block: `## ${call.name}\nError: subagent not found`, error: true };
  if (!deps.registryRef.current) return { block: `## ${call.name}\nError: registry not ready`, error: true };
  const out = await runSubagent({
    agent,
    task: call.task,
    config: deps.config,
    model: deps.modelRef.current,
    registry: deps.registryRef.current,
    approvalGateway: deps.approvalGateway,
    approvalChannelId: deps.approvalChannelId,
    runRegistry: deps.runRegistry,
    messageBus: deps.messageBusRef.current,
    resolveSessionPath: deps.resolveSessionPath,
    signal,
  });
  return {
    block: `## ${call.name}${out.error ? ' (error)' : ''}\n${out.content}`,
    error: out.error,
  };
}
