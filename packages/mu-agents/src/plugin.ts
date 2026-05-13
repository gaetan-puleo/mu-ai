import { newMessage, type Message, type Plugin, type Session } from 'mu-core';
import {
  type ApprovalChannel,
  type ApprovalDecision,
  type ApprovalRequest,
  ApprovalGateway,
} from './approval';
import { type Agent, loadAgentsFromDir } from './markdown';
import {
  type MentionCompletion,
  createAgentCompletions,
  parseMention,
} from './mention';
import { createSubAgentBus, type SubAgentBus, type SubAgentEvent } from './subAgentBus';
import { createSubagentParallelTool, createSubagentTool } from './subagent';
import { type SwitchEvent, createSwitchTracker, type SwitchTracker } from './switches';

export type {
  Agent,
  ApprovalChannel,
  ApprovalDecision,
  ApprovalRequest,
  MentionCompletion,
  SubAgentEvent,
  SwitchEvent,
};
export type { Action, PermissionMap, ToolPermission } from './permissions';

export interface AgentsPluginOptions {
  /** Directly-provided agents. Merged with any loaded from `dirs`. */
  agents?: Agent[];
  /** Directories scanned for `*.md` agent files. Later entries override earlier names. */
  dirs?: string[];
  /** Default agent name. Falls back to the first registered agent. */
  defaultAgent?: string;
  /** Plugged-in approval channel. Required when any agent has `ask` rules. */
  approval?: ApprovalChannel;
}

export interface AgentsHandle {
  list(): Agent[];
  get(name: string): Agent | undefined;
  /** Agent active for the *next* turn (mention override > persistent > default). */
  getActive(session: Session): Agent | undefined;
  /** Programmatic persistent switch. Returns false if the name is unknown. */
  setActive(session: Session, name: string): boolean;

  switches(sessionId: string): readonly SwitchEvent[];
  onSwitch(fn: (event: SwitchEvent) => void): () => void;
  onSubAgentEvent(parentSessionId: string, fn: (e: SubAgentEvent) => void): () => void;
  getCompletions(partial: string): MentionCompletion[];
}

function buildAgents(options: AgentsPluginOptions): Map<string, Agent> {
  const out = new Map<string, Agent>();
  for (const dir of options.dirs ?? []) {
    for (const agent of loadAgentsFromDir(dir)) out.set(agent.name, agent);
  }
  for (const agent of options.agents ?? []) out.set(agent.name, agent);
  return out;
}

export function createAgentsPlugin(options: AgentsPluginOptions = {}): Plugin & { handle: AgentsHandle } {
  const agents = buildAgents(options);
  const knownNames = new Set(agents.keys());
  const defaultAgent = options.defaultAgent ?? agents.keys().next().value;

  // Per-session state — kept in plugin closure, not on Session itself.
  const active = new Map<string, string>();
  const pendingMention = new Map<string, string>();

  const tracker: SwitchTracker = createSwitchTracker();
  const bus: SubAgentBus = createSubAgentBus();
  const gateway = new ApprovalGateway(options.approval);
  const inFlightSubAgents = new Set<Session>();

  // The subagent tools need to know "what session is currently invoking me?".
  // Tools don't receive the session today, so we track the most-recent
  // active session per turn via beforeToolExec and expose it through a getter.
  let activeParent: Session | undefined;

  const resolveActiveForTurn = (session: Session): Agent | undefined => {
    const mentionName = pendingMention.get(session.id);
    if (mentionName) return agents.get(mentionName);
    const persistent = active.get(session.id) ?? defaultAgent;
    return persistent ? agents.get(persistent) : undefined;
  };

  const handle: AgentsHandle = {
    list: () => Array.from(agents.values()),
    get: (name) => agents.get(name),
    getActive: (session) => resolveActiveForTurn(session),
    setActive: (session, name) => {
      if (!agents.has(name)) return false;
      const from = active.get(session.id);
      active.set(session.id, name);
      tracker.log({ sessionId: session.id, from, to: name, reason: 'programmatic' });
      return true;
    },
    switches: (sessionId) => tracker.history(sessionId),
    onSwitch: (fn) => tracker.subscribe(fn),
    onSubAgentEvent: (parentSessionId, fn) => bus.onParent(parentSessionId, fn),
    getCompletions: createAgentCompletions(() => Array.from(agents.values())),
  };

  const plugin: Plugin = {
    name: 'mu-agents',
    register(api) {
      // Register the sub-agent tools so the LLM can delegate.
      const deps = {
        api,
        agents,
        bus,
        inFlight: inFlightSubAgents,
      };
      api.tool(createSubagentTool(deps, () => activeParent));
      api.tool(createSubagentParallelTool(deps, () => activeParent));

      api.hook({
        async onMessageAppend(msg, session) {
          if (msg.role !== 'user') return undefined;
          const parsed = parseMention(msg.content, knownNames);
          if (!parsed.mention) return undefined;
          const from = active.get(session.id);
          pendingMention.set(session.id, parsed.mention.agent);
          tracker.log({
            sessionId: session.id,
            from,
            to: parsed.mention.agent,
            reason: 'mention',
          });
          // Keep the mention text in the transcript; LLM-side stripping happens
          // in beforeLlmCall so the user can still see what they typed.
          return undefined;
        },

        beforeLlmCall(messages, session) {
          const agent = resolveActiveForTurn(session);
          const out: Message[] = [];

          if (agent?.prompt) {
            out.push(
              newMessage({
                role: 'system',
                content: agent.prompt,
                meta: { source: 'mu-agents', visibility: 'llm', transient: true },
              }),
            );
          }

          // Strip leading mention from the last user message for the LLM only.
          for (let i = 0; i < messages.length; i++) {
            const m = messages[i] as Message;
            const isLastUser = m.role === 'user' && i === messages.length - 1;
            if (!isLastUser) {
              out.push(m);
              continue;
            }
            const parsed = parseMention(m.content, knownNames);
            if (parsed.mention) {
              out.push({ ...m, content: parsed.cleaned });
            } else {
              out.push(m);
            }
          }
          return out;
        },

        async beforeToolExec(call, session) {
          activeParent = session;
          const agent = resolveActiveForTurn(session);
          if (!agent) return call;
          const tool = api.getTool(call.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments) as Record<string, unknown>;
          } catch {
            /* leave args empty */
          }
          const matchKey = tool?.matchKey?.(args);
          return await gateway.check({ session, agent, call, matchKey });
        },

        onTurnEnd(_reason, session) {
          if (!pendingMention.has(session.id)) return;
          const reverted = pendingMention.get(session.id);
          pendingMention.delete(session.id);
          const persistent = active.get(session.id) ?? defaultAgent;
          if (persistent && reverted !== persistent) {
            tracker.log({
              sessionId: session.id,
              from: reverted,
              to: persistent,
              reason: 'mention-revert',
            });
          }
        },

        onSessionEnd(session) {
          gateway.clearSession(session.id);
          tracker.clearSession(session.id);
          active.delete(session.id);
          pendingMention.delete(session.id);
        },
      });
    },
    async deactivate() {
      for (const child of inFlightSubAgents) {
        try {
          child.abort();
        } catch {
          /* swallow */
        }
      }
      inFlightSubAgents.clear();
      bus.clear();
    },
  };

  return Object.assign(plugin, { handle });
}

export default createAgentsPlugin;
