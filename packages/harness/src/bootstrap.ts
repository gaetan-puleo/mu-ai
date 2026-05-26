/**
 * Cross-host bootstrap helper.
 *
 * Both arya and coding-agent (and any future host) need the same wiring:
 *   - resolve XDG paths
 *   - load .env
 *   - load plugins from disk + npm
 *   - load skills, sub-agents, permissions
 *   - build a sessions store (jsonl by default, in-memory if asked)
 *   - build an approval queue
 *   - register default slash commands
 *   - build the permission hook (per-primary-agent or from a permissions file)
 *   - build the tools (base + subagent dispatcher)
 *   - assemble the system prompt (primary agent body + skills block)
 *
 * What the host still owns:
 *   - the LLM provider plugin (it's host config)
 *   - the transport (TUI, WS, etc.)
 *   - the model state (which model is currently selected)
 */
import { existsSync } from 'node:fs';
import {
  type CoreEvent,
  createBus,
  createInMemorySessionStore,
  type EventBus,
  type Plugin,
  type SessionStore,
  type Tools,
} from 'mu-core';
import { type ApprovalQueue, approvalQueueToPrompt, createApprovalQueue } from './approvals/queue';
import {
  type AgentsCommandDeps,
  createAgentsCommand,
  createHelpCommand,
  createSessionsCommand,
} from './commands/defaults';
import { type CommandRegistry, createCommandRegistry } from './commands/registry';
import { createXdgPaths, type XdgPaths } from './paths/xdg';
import { createPermissionHook } from './permissions/hook';
import { loadPermissions } from './permissions/loader';
import { createPermissionRegistry } from './permissions/registry';
import type { PermissionConfig } from './permissions/types';
import { loadPlugins } from './plugin-loader';
import { createJsonlSessionStore } from './sessions/jsonl-store';
import { loadSkills } from './skills/loader';
import { formatSkillsForSystemPrompt } from './skills/system-prompt';
import { loadSubAgents } from './sub-agents/loader';
import { filterToolsByPrimary, pickPrimaryAgent } from './sub-agents/primary';
import { createSubAgentParallelTool, createSubAgentTool } from './sub-agents/tool';
import type { SubAgent } from './sub-agents/types';

export type SessionStoreMode = 'jsonl' | 'memory';

export type PermissionSource = 'primary-agent' | 'permissions-file' | 'none';

export interface BootstrapOptions {
  /** Host name, drives XDG paths (e.g. 'arya', 'coding-agent'). */
  hostName: string;
  /** Override XDG paths if needed (e.g. for testing). Defaults to `createXdgPaths(hostName)`. */
  paths?: XdgPaths;
  /**
   * Extra directories to consult on top of the XDG layout. Useful for
   * project-local overrides (e.g. `./definitions/agents`, `./.mu/skills`).
   */
  extraAgentsDirs?: string[];
  extraSkillsDirs?: string[];
  /** Extra permissions files (in addition to `<configDir>/permissions.json`). */
  extraPermissionsFiles?: string[];
  /** npm specs to pre-load as plugins. */
  npmPlugins?: string[];
  /** Pre-built provider plugin (LLM access). */
  providerPlugin?: Plugin;
  /** Additional plugins (webfetch, scheduler, custom). */
  extraPlugins?: Plugin[];
  /** Base tool map (e.g. mu-tools). The primary agent's allow-list filters this. */
  baseTools?: Tools;
  /** How permissions are resolved. Defaults to `primary-agent` if available, then `permissions-file`. */
  permissionSource?: PermissionSource;
  /** Override default decision when no permission rule matches. */
  defaultPermissionDecision?: 'allow' | 'deny' | 'ask';
  /** Choose session storage. `jsonl` writes to `<dataDir>/sessions`. */
  sessionStore?: SessionStoreMode | SessionStore;
  /** Reuse an existing approval queue (so the transport can listen to it). */
  approvalQueue?: ApprovalQueue;
  /** Inject extra commands beyond the defaults. */
  extraCommands?: ReturnType<CommandRegistry['list']>;
  /** Skip default commands (`/agents`, `/sessions`, `/help`). Useful when the host wants total control. */
  skipDefaultCommands?: boolean;
  /** Reuse an existing event bus instead of creating one. */
  bus?: EventBus<CoreEvent>;
  /**
   * When provided, hooks + systemPrompt + tool filtering are dynamic: each turn
   * reads from this getter so the host can swap primary agents at runtime.
   * Use the returned `primaryAgents` to know which agents are switchable.
   */
  getActivePrimary?: () => SubAgent | undefined;
}

export interface BootstrapResult {
  bus: EventBus<CoreEvent>;
  store: SessionStore;
  approvalQueue: ApprovalQueue;
  /** First primary agent picked at boot. Stable across the run. */
  primaryAgent: SubAgent | undefined;
  /** Every agent declared with `type: primary`. Hosts that support switching iterate this list. */
  primaryAgents: SubAgent[];
  subAgents: SubAgent[];
  /** Tools the runtime should expose (after primary-agent filtering and subagent injection). */
  tools: Tools;
  /** Plugins composed for the runtime (provider + extras + user plugins). */
  plugins: Plugin[];
  /** System prompt function (primary agent body + skills block). */
  systemPrompt: () => string | undefined;
  /** Pre-built tool hooks (permission gate). Pass straight into `createRuntime({ hooks })`. */
  hooks: { beforeTool: ReturnType<typeof createPermissionHook> };
  /**
   * Per-turn tool filter. In dynamic mode this filters by the active primary
   * agent's allow-list so disallowed tools are entirely hidden from the LLM
   * (no schema, no system prompt). Undefined in static mode (filtering happens
   * once at construction).
   */
  toolFilter?: (tools: Tools) => Tools;
}

export async function bootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const paths = opts.paths ?? createXdgPaths(opts.hostName);

  const skillsDirs = uniqueExisting([paths.skillsDir, ...(opts.extraSkillsDirs ?? [])]);
  const subAgentsDirs = uniqueExisting([paths.agentsDir, ...(opts.extraAgentsDirs ?? [])]);
  const permissionsFiles = unique([paths.permissionsFile, ...(opts.extraPermissionsFiles ?? [])]);

  // 3. Resources from disk
  const userPlugins = await loadPlugins({
    localDir: paths.pluginsDir,
    npmSpecs: opts.npmPlugins,
  });
  const subAgentsAll = loadSubAgents(subAgentsDirs);
  const skills = loadSkills(skillsDirs);
  const primaryAgents = subAgentsAll.filter((a) => a.type === 'primary');
  const primaryAgent = pickPrimaryAgent(subAgentsAll);
  const subAgents = subAgentsAll.filter((a) => a.type !== 'primary');
  const dynamic = Boolean(opts.getActivePrimary);
  const resolveActivePrimary = (): SubAgent | undefined =>
    dynamic ? opts.getActivePrimary!() ?? primaryAgent : primaryAgent;

  // 4. Permissions
  const source: PermissionSource = opts.permissionSource ?? (primaryAgent ? 'primary-agent' : 'permissions-file');
  const defaultDecision = opts.defaultPermissionDecision ?? 'ask';
  let permissionConfig: PermissionConfig;
  if (source === 'primary-agent' && primaryAgent) {
    permissionConfig = { rules: primaryAgent.permissions, default: defaultDecision };
  } else if (source === 'permissions-file') {
    permissionConfig = loadPermissions(permissionsFiles);
  } else {
    permissionConfig = { rules: [], default: defaultDecision };
  }

  // 5. Approval queue + permission hook
  const approvalQueue = opts.approvalQueue ?? createApprovalQueue();
  // Static path: one frozen registry from boot-time config.
  // Dynamic path: rebuild the registry per call so swapping the active primary
  // immediately changes which rules apply to the next tool call.
  const staticRegistry = createPermissionRegistry(permissionConfig);
  const permissionHook = dynamic
    ? createPermissionHook({
      registry: {
        check(call) {
          const active = resolveActivePrimary();
          if (!active) return staticRegistry.check(call);
          // Tool filtering hides disallowed tools from the LLM entirely (via
          // toolFilter, see below); here we only need to evaluate the active
          // agent's permission rules.
          const registry = createPermissionRegistry({
            rules: active.permissions,
            default: defaultDecision,
          });
          return registry.check(call);
        },
      },
      prompt: approvalQueueToPrompt(approvalQueue),
    })
    : createPermissionHook({
      registry: staticRegistry,
      prompt: approvalQueueToPrompt(approvalQueue),
    });

  // 6. Session store
  const store: SessionStore = typeof opts.sessionStore === 'object' && opts.sessionStore !== null
    ? opts.sessionStore
    : opts.sessionStore === 'memory'
    ? createInMemorySessionStore()
    : createJsonlSessionStore(paths.sessionsDir);

  // 7. Bus
  const bus = opts.bus ?? createBus<CoreEvent>();

  // 8. Plugins
  const plugins: Plugin[] = [
    ...(opts.providerPlugin ? [opts.providerPlugin] : []),
    ...(opts.extraPlugins ?? []),
    ...userPlugins,
  ];

  // 9. Tools: dynamic mode keeps every base tool (active filter happens in
  // the permission hook); static mode pre-filters by the boot-time primary.
  let tools: Tools = dynamic
    ? { ...(opts.baseTools ?? {}) }
    : filterToolsByPrimary(opts.baseTools ?? {}, primaryAgent);

  if (subAgents.length > 0) {
    const deps = {
      getSubAgents: () => subAgents,
      getTools: () => tools,
      getPlugins: () => plugins,
      approvalPrompt: approvalQueueToPrompt(approvalQueue),
    };
    tools = {
      ...tools,
      subagent: createSubAgentTool(deps),
      subagent_parallel: createSubAgentParallelTool(deps),
    };
  }

  // 10. System prompt — closes over the active primary so swapping affects
  // the next turn immediately.
  const systemPrompt = (): string | undefined => {
    const active = resolveActivePrimary();
    const primaryBlock = active?.prompt ?? '';
    const skillsBlock = formatSkillsForSystemPrompt(skills);
    const combined = [primaryBlock, skillsBlock].filter(Boolean).join('\n\n');
    return combined || undefined;
  };

  // 10b. Tool filter — in dynamic mode the active primary's allow-list hides
  // disallowed tools from the LLM entirely (no schema, no system prompt for them).
  const toolFilter: ((tools: Tools) => Tools) | undefined = dynamic
    ? (merged) => filterToolsByPrimary(merged, resolveActivePrimary())
    : undefined;

  // 11. Commands
  const commandRegistry = createCommandRegistry();
  if (!opts.skipDefaultCommands) {
    const agentsDeps: AgentsCommandDeps = { getSubAgents: () => subAgents };
    commandRegistry.register(createAgentsCommand(agentsDeps));
    commandRegistry.register(createSessionsCommand({ store }));
    commandRegistry.register(createHelpCommand({ list: () => commandRegistry.list() }));
  }
  for (const cmd of opts.extraCommands ?? []) {
    commandRegistry.register(cmd);
  }

  return {
    bus,
    store,
    approvalQueue,
    primaryAgent,
    primaryAgents,
    subAgents,
    tools,
    plugins,
    systemPrompt,
    hooks: { beforeTool: permissionHook },
    toolFilter,
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueExisting(values: string[]): string[] {
  return Array.from(new Set(values)).filter(existsSync);
}
