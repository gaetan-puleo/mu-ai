import { newId, newMessage, type PluginAPI, type Session, type Tool } from 'mu-core';
import type { Agent } from './markdown';
import type { SubAgentBus } from './subAgentBus';

export interface SubAgentRunOptions {
  parentSession: Session;
  agentName: string;
  task: string;
}

export interface SubAgentResult {
  runId: string;
  agentName: string;
  content: string;
  error?: string;
}

export interface SubAgentDeps {
  api: PluginAPI;
  agents: Map<string, Agent>;
  bus: SubAgentBus;
  /** Track in-flight sub-agent sessions for abort propagation on deactivate. */
  inFlight: Set<Session>;
  /** Bind an agent name to a child session so hooks resolve the correct agent. */
  bindAgentToSession?: (session: Session, agentName: string) => void;
  /** Unbind the agent name when the child session ends. */
  unbindAgentFromSession?: (session: Session) => void;
}

const SUBAGENT_SOURCE = 'mu-agents-subagent';

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: subagent runner coordinates session lifecycle and event forwarding
export async function runSubAgent(opts: SubAgentRunOptions, deps: SubAgentDeps): Promise<SubAgentResult> {
  const { parentSession, agentName, task } = opts;
  const runId = newId('subrun');
  const agent = deps.agents.get(agentName);

  const emit = (type: Parameters<SubAgentBus['emit']>[0]['type'], detail?: unknown): void => {
    deps.bus.emit({
      runId,
      parentSessionId: parentSession.id,
      agentName,
      type,
      detail,
    });
  };

  if (!agent) {
    const err = `Unknown sub-agent: "${agentName}"`;
    emit('error', err);
    return { runId, agentName, content: err, error: err };
  }

  const child = deps.api.createSession({ meta: { source: SUBAGENT_SOURCE } });
  deps.inFlight.add(child);
  deps.bindAgentToSession?.(child, agentName);

  // Propagate parent abort to the child.
  const abortListener = (event: import('mu-core').SessionEvent): void => {
    if (event.type === 'session_ended' || (event.type === 'turn_ended' && event.reason === 'aborted')) {
      child.abort();
    }
  };
  const offParent = parentSession.on(abortListener);

  emit('started', { task, sessionId: child.id });

  let lastContent = '';
  let finalContent = '';
  let errorMessage: string | undefined;

  try {
    const userMsg = newMessage({ role: 'user', content: task });
    for await (const ev of child.run({ userMessage: userMsg })) {
      if (ev.type === 'content') {
        const delta = ev.text.slice(lastContent.length);
        if (delta) emit('content', delta);
        lastContent = ev.text;
        finalContent = ev.text;
      } else if (ev.type === 'message') {
        if (ev.message.role === 'assistant' && ev.message.toolCalls?.length) {
          for (const tc of ev.message.toolCalls) {
            emit('tool_call', { id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
          }
        } else if (ev.message.role === 'tool' && ev.message.toolResult) {
          emit('tool_result', {
            toolCallId: ev.message.toolCallId,
            name: ev.message.toolResult.name,
            content: ev.message.toolResult.content,
            error: ev.message.toolResult.error,
          });
        } else if (ev.message.role === 'assistant' && ev.message.content) {
          finalContent = ev.message.content;
        }
      } else if (ev.type === 'turn_end') {
        if (ev.error) errorMessage = ev.error.message;
        if (ev.reason === 'aborted' && !errorMessage) errorMessage = 'aborted';
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    offParent();
    deps.unbindAgentFromSession?.(child);
    child.end();
    deps.inFlight.delete(child);
  }

  if (errorMessage) {
    emit('error', errorMessage);
    return { runId, agentName, content: finalContent, error: errorMessage };
  }

  emit('completed', { content: finalContent });
  return { runId, agentName, content: finalContent };
}

// ─── Tool factories ─────────────────────────────────────────────────────────

function buildAgentEnum(agents: Map<string, Agent>): string[] {
  return Array.from(agents.keys());
}

export function createSubagentTool(deps: SubAgentDeps, parentSession: () => Session | undefined): Tool {
  return {
    name: 'subagent',
    description: 'Delegate an isolated task to a named sub-agent. Returns the sub-agent’s final answer.',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Sub-agent name.',
          enum: buildAgentEnum(deps.agents),
        },
        task: { type: 'string', description: 'The task to delegate.' },
      },
      required: ['agent', 'task'],
      additionalProperties: false,
    },
    matchKey: (args) => (typeof args.agent === 'string' ? args.agent : undefined),
    formatArgs: (args) => {
      const agent = typeof args.agent === 'string' ? args.agent : String(args.agent ?? '');
      const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');
      return [
        { label: 'agent', value: agent },
        { label: 'task', value: task.length > 120 ? `${task.slice(0, 120)}…` : task },
      ];
    },
    async execute(args) {
      const parent = parentSession();
      if (!parent) {
        return { content: 'Error: subagent tool invoked outside a parent session', error: true };
      }
      const agentName = String(args.agent ?? '');
      const task = String(args.task ?? '');
      if (!(agentName && task)) {
        return { content: 'Error: subagent requires both `agent` and `task`', error: true };
      }
      const result = await runSubAgent({ parentSession: parent, agentName, task }, deps);
      return { content: result.content, error: Boolean(result.error) };
    },
  };
}

export function createSubagentParallelTool(deps: SubAgentDeps, parentSession: () => Session | undefined): Tool {
  return {
    name: 'subagent_parallel',
    description: 'Fan out N sub-agents in parallel. Returns all results aggregated.',
    parameters: {
      type: 'object',
      properties: {
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string', enum: buildAgentEnum(deps.agents) },
              task: { type: 'string' },
            },
            required: ['agent', 'task'],
            additionalProperties: false,
          },
        },
      },
      required: ['runs'],
      additionalProperties: false,
    },
    formatArgs: (args) => {
      const runs = Array.isArray(args.runs) ? args.runs : [];
      return runs.map((r, i) => {
        const item = r as { agent?: unknown; task?: unknown };
        const agent = typeof item.agent === 'string' ? item.agent : '?';
        const taskRaw = typeof item.task === 'string' ? item.task : '?';
        const task = taskRaw.length > 80 ? `${taskRaw.slice(0, 80)}…` : taskRaw;
        return { label: `#${i + 1}`, value: `${agent}: ${task}` };
      });
    },
    async execute(args) {
      const parent = parentSession();
      if (!parent) {
        return { content: 'Error: subagent_parallel invoked outside a parent session', error: true };
      }
      const runs = Array.isArray(args.runs) ? args.runs : [];
      if (runs.length === 0) {
        return { content: 'Error: subagent_parallel requires at least one run', error: true };
      }
      const results = await Promise.all(
        runs.map((r) => {
          const item = r as { agent?: unknown; task?: unknown };
          const agentName = String(item.agent ?? '');
          const task = String(item.task ?? '');
          return runSubAgent({ parentSession: parent, agentName, task }, deps);
        }),
      );
      const content = results
        .map((r) => {
          const header = `## ${r.agentName}${r.error ? ' (error)' : ''}`;
          return `${header}\n${r.content || r.error || ''}`;
        })
        .join('\n\n---\n\n');
      return { content, error: results.some((r) => r.error !== undefined) };
    },
  };
}
