import {
  type LifecycleHooks,
  type PluginRegistry,
  type PluginRegistryView,
  type PluginTool,
  runAgent,
} from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import type { AgentManager } from './manager';
import type { AgentDefinition } from './types';

/**
 * `runAgent` requires a full `PluginRegistry`, but the agent plugin only
 * receives a read-only `PluginRegistryView` through its context. Build a
 * thin shim that exposes just the surface `runAgent` reaches for, with the
 * subagent's tool whitelist baked in and parent hooks stripped (so we don't
 * re-apply the *primary* agent's tool filter inside a nested run).
 */
function shimRegistry(view: PluginRegistryView, agent: AgentDefinition): PluginRegistry {
  const allowed = new Set(agent.tools);
  const allowAll = allowed.has('*');

  const filtered = async (): Promise<PluginTool[]> => {
    const tools = view.getTools();
    return allowAll ? tools : tools.filter((t) => allowed.has(t.definition.function.name));
  };

  // Build a stub that satisfies `runAgent`'s registry-shaped contract. We
  // cast through `unknown` because we don't want to import the full
  // `PluginRegistry` class implementation just to satisfy structural typing.
  const noopHooks: LifecycleHooks[] = [];
  const stub = {
    getTools: () => view.getTools(),
    getFilteredTools: filtered,
    getHooks: () => noopHooks,
    getSystemPrompts: async () => [],
    applySystemPromptTransforms: async (prompt: string) => prompt,
    getAgentLoop: () => undefined,
  };
  return stub as unknown as PluginRegistry;
}

interface SubagentResult {
  content: string;
  error: boolean;
}

/**
 * Run a subagent through the same `runAgent` loop as the host. The
 * subagent's system prompt is injected as a `system` message at position 0
 * so it doesn't leak into the parent agent's prompt accumulator. Tool
 * filtering is enforced via the shimmed registry above.
 *
 * Returns a typed `{ content, error }` so callers don't have to sniff
 * `content.startsWith('Error:')` (fragile heuristic that collides with
 * legitimate output that begins with that prefix).
 */
export async function runSubagent(options: {
  agent: AgentDefinition;
  task: string;
  config: ProviderConfig;
  model: string;
  registry: PluginRegistryView;
  signal?: AbortSignal;
}): Promise<SubagentResult> {
  const { agent, task, config, model, registry, signal } = options;

  const messages: ChatMessage[] = [
    { role: 'system', content: agent.systemPrompt },
    { role: 'user', content: task },
  ];

  const subRegistry = shimRegistry(registry, agent);
  // `new AbortController().signal` is always defined; no need for a guard.
  const usedSignal = signal ?? new AbortController().signal;

  let last = '';
  try {
    for await (const event of runAgent(messages, config, model, usedSignal, subRegistry)) {
      if (event.type === 'messages') {
        const final = event.messages[event.messages.length - 1];
        if (final?.role === 'assistant' && final.content) last = final.content;
      }
    }
  } catch (err) {
    return {
      content: `Subagent '${agent.name}' failed: ${err instanceof Error ? err.message : 'unknown'}`,
      error: true,
    };
  }
  if (!last) {
    return { content: `Subagent '${agent.name}' produced no output.`, error: true };
  }
  return { content: last, error: false };
}

interface SubagentToolDeps {
  manager: AgentManager;
  config: ProviderConfig;
  modelRef: { current: string };
  registryRef: { current: PluginRegistryView | null };
}

/** Build the `subagent` tool: run a single subagent with a task. */
export function createSubagentTool(deps: SubagentToolDeps): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'subagent',
        description:
          'Dispatch a subagent for an isolated task. The subagent has its own system prompt and tool whitelist; output is returned as text.',
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
          'Run multiple subagents in parallel. Each entry runs independently; results are concatenated and returned in input order.',
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
    signal,
  });
  return {
    block: `## ${call.name}${out.error ? ' (error)' : ''}\n${out.content}`,
    error: out.error,
  };
}
