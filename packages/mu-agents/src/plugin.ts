import { type Message, newMessage, type Plugin, type Session, type Tool } from 'mu-core';
import { type ApprovalChannel, type ApprovalDecision, ApprovalGateway, type ApprovalRequest } from './approval';
import type { KeybindChannel } from './keybinds';
import { type Agent, loadAgentsFromDir } from './markdown';
import { createAgentCompletions, type MentionCompletion, parseMention } from './mention';
import { createSubAgentBus, type SubAgentBus, type SubAgentEvent } from './subAgentBus';
import {
  createSubagentParallelTool,
  createSubagentTool,
  runSubAgent,
  type SubAgentDeps,
  type SubAgentResult,
} from './subagent';
import { createSwitchTracker, type SwitchEvent, type SwitchTracker } from './switches';

export type { Action, PermissionMap, ToolPermission } from './permissions';
export type {
  Agent,
  ApprovalChannel,
  ApprovalDecision,
  ApprovalRequest,
  MentionCompletion,
  SubAgentEvent,
  SwitchEvent,
};

export interface AgentsPluginOptions {
  /** Directly-provided agents. Merged with any loaded from `dirs`. */
  agents?: Agent[];
  /** Directories scanned for `*.md` agent files. Later entries override earlier names. */
  dirs?: string[];
  /** Default agent name. Falls back to the first registered agent. */
  defaultAgent?: string;
  /** Plugged-in approval channel. Required when any agent has `ask` rules. */
  approval?: ApprovalChannel;
  /**
   * Host-provided keybind channel. When set, mu-agents registers its
   * interactive shortcuts (currently: Shift+Tab → cycle active agent).
   * When unset (e.g. headless host, tests) the plugin silently skips
   * keybind wiring. mu-agents does NOT depend on any concrete TUI
   * implementation — the host (mu-coding) implements `KeybindChannel`
   * by adapting its TUI_KEYBINDS singleton.
   */
  keybinds?: KeybindChannel;
}

export interface AgentsHandle {
  list: () => Agent[];
  /** Only `kind === 'primary'` agents — those a user can drive interactively. */
  listPrimary: () => Agent[];
  get: (name: string) => Agent | undefined;
  /** Agent active for the *next* turn (mention override > persistent > default). */
  getActive: (session: Session) => Agent | undefined;
  /** Programmatic persistent switch. Returns false if the name is unknown. */
  setActive: (session: Session, name: string) => boolean;
  /** Cycle the persistent active agent to the next primary in registration order. */
  cycleActive: (session: Session) => Agent | undefined;

  switches: (sessionId: string) => readonly SwitchEvent[];
  onSwitch: (fn: (event: SwitchEvent) => void) => () => void;
  onSubAgentEvent: (parentSessionId: string, fn: (e: SubAgentEvent) => void) => () => void;
  runSubAgent: (parentSession: Session, agentName: string, task: string) => Promise<SubAgentResult>;
  getCompletions: (partial: string) => MentionCompletion[];
}

function buildAgents(options: AgentsPluginOptions): Map<string, Agent> {
  const out = new Map<string, Agent>();
  for (const dir of options.dirs ?? []) {
    for (const agent of loadAgentsFromDir(dir)) out.set(agent.name, agent);
  }
  for (const agent of options.agents ?? []) out.set(agent.name, agent);
  return out;
}

// ─── Plugin-contributed agent directories ────────────────────────────────────
// Other plugins (e.g. `mu-coding-agents`) call `contributeAgentsDir(...)` from
// their `register()` to ship default agent packs. The directories are drained
// inside `mu-agents`' own `register()`, so contribution must happen *before*
// the agents plugin registers. `Mu.start` runs plugin `register()` calls in
// declaration order, so list contributor plugins before `agents` in the
// `plugins` array.
const contributedDirs: string[] = [];

export function contributeAgentsDir(dir: string): void {
  contributedDirs.push(dir);
}

function drainContributedDirs(): string[] {
  const drained = contributedDirs.slice();
  contributedDirs.length = 0;
  return drained;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: plugin wiring is intentionally centralized
export function createAgentsPlugin(options: AgentsPluginOptions = {}): Plugin & { handle: AgentsHandle } {
  const agents = buildAgents(options);
  // `knownNames` and `defaultAgent` are recomputed after register() so any
  // plugin-contributed dirs (e.g. mu-coding-agents) are picked up.
  let knownNames = new Set(agents.keys());
  let defaultAgent = options.defaultAgent ?? agents.keys().next().value;

  // Per-session state — kept in plugin closure, not on Session itself.
  const active = new Map<string, string>();
  const pendingMention = new Map<string, string>();
  // Maps subagent child sessions to their agent name so hooks resolve correctly.
  const subAgentOf = new Map<string, string>();

  const tracker: SwitchTracker = createSwitchTracker();
  const bus: SubAgentBus = createSubAgentBus();
  const gateway = new ApprovalGateway(options.approval);
  const inFlightSubAgents = new Set<Session>();
  /**
   * Detacher for the host-provided keybind registration. Populated in
   * `register()` when `options.keybinds` is set; invoked in `deactivate()`
   * so unloading mu-agents (or restarting the host) cleanly drops the
   * binding from the registry.
   */
  let detachKeybind: (() => void) | null = null;

  // The subagent tools need to know "what session is currently invoking me?".
  // Tools don't receive the session today, so we track the most-recent
  // active session per turn via beforeToolExec and expose it through a getter.
  let activeParent: Session | undefined;
  let subAgentDeps: SubAgentDeps | undefined;

  const resolveActiveForTurn = (session: Session): Agent | undefined => {
    const subAgentName = subAgentOf.get(session.id);
    if (subAgentName) return agents.get(subAgentName);
    const mentionName = pendingMention.get(session.id);
    if (mentionName) return agents.get(mentionName);
    const persistent = active.get(session.id) ?? defaultAgent;
    return persistent ? agents.get(persistent) : undefined;
  };

  const listPrimary = (): Agent[] => Array.from(agents.values()).filter((a) => a.kind === 'primary');

  const handle: AgentsHandle = {
    list: () => Array.from(agents.values()),
    listPrimary,
    get: (name) => agents.get(name),
    getActive: (session) => resolveActiveForTurn(session),
    setActive: (session, name) => {
      if (!agents.has(name)) return false;
      const from = active.get(session.id);
      active.set(session.id, name);
      tracker.log({ sessionId: session.id, from, to: name, reason: 'programmatic' });
      return true;
    },
    cycleActive: (session) => {
      const primaries = listPrimary();
      if (primaries.length === 0) return undefined;
      const currentName = active.get(session.id) ?? defaultAgent;
      const idx = primaries.findIndex((a) => a.name === currentName);
      const next = primaries[(idx + 1) % primaries.length];
      if (!next) return undefined;
      const from = active.get(session.id);
      active.set(session.id, next.name);
      tracker.log({ sessionId: session.id, from, to: next.name, reason: 'programmatic' });
      return next;
    },
    switches: (sessionId) => tracker.history(sessionId),
    onSwitch: (fn) => tracker.subscribe(fn),
    onSubAgentEvent: (parentSessionId, fn) => bus.onParent(parentSessionId, fn),
    runSubAgent: (parentSession, agentName, task) => {
      if (!subAgentDeps) throw new Error('agents plugin is not registered');
      return runSubAgent({ parentSession, agentName, task }, subAgentDeps);
    },
    getCompletions: createAgentCompletions(() => Array.from(agents.values())),
  };

  const plugin: Plugin = {
    name: 'mu-agents',
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: plugin registration wires related hooks/tools together
    register(api) {
      // Merge any dirs contributed by other plugins that registered earlier
      // (see `contributeAgentsDir`). Later entries override earlier names,
      // matching the constructor-time merge order.
      for (const dir of drainContributedDirs()) {
        for (const agent of loadAgentsFromDir(dir)) agents.set(agent.name, agent);
      }
      knownNames = new Set(agents.keys());
      if (!defaultAgent) defaultAgent = agents.keys().next().value;

      // Host-provided keybind: Shift+Tab cycles the active agent for the
      // session the host says is currently focused. Registered here (not
      // in mu-coding) so the binding lives with the plugin that owns the
      // agent UX; mu-agents stays TUI-agnostic by going through the
      // structural KeybindChannel interface. When no channel is provided
      // (headless host, tests) we silently skip.
      if (options.keybinds) {
        const { registry, currentSession } = options.keybinds;
        // Plain Tab cycles the active agent. The command palette also
        // intercepts Tab (to advance its cursor), but that branch lives
        // in the host's reserved-keys block and runs BEFORE the plugin
        // dispatcher — so the palette wins while it's open. ink-text-
        // input also ignores Tab (see its useInput handler), so the
        // prompt textfield never absorbs the keystroke.
        detachKeybind = registry.register({
          chord: { tab: true },
          description: 'cycle active agent',
          when: () => currentSession() !== null,
          run: () => {
            const session = currentSession();
            if (!session) return false;
            handle.cycleActive(session);
            return true;
          },
        });
      }

      // Register the sub-agent tools so the LLM can delegate.
      const deps = {
        api,
        agents,
        bus,
        inFlight: inFlightSubAgents,
        bindAgentToSession: (session: Session, agentName: string) => {
          subAgentOf.set(session.id, agentName);
        },
        unbindAgentFromSession: (session: Session) => {
          subAgentOf.delete(session.id);
        },
      };
      subAgentDeps = deps;
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
          const argLines = tool?.formatArgs?.(args);
          return await gateway.check({ session, agent, call, matchKey, argLines });
        },

        filterTools(tools: Tool[], session: Session): Tool[] {
          const agent = resolveActiveForTurn(session);
          if (!agent) return tools;
          if (agent.tools.includes('*')) return tools;
          const allowed = new Set(agent.tools);
          return tools.filter((t) => allowed.has(t.name));
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
          subAgentOf.delete(session.id);
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
      subAgentOf.clear();
      bus.clear();
      try {
        detachKeybind?.();
      } catch {
        /* keybind cleanup is best-effort */
      }
      detachKeybind = null;
    },
  };

  return Object.assign(plugin, { handle });
}

export default createAgentsPlugin;
