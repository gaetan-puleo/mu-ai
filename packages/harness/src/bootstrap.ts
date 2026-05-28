/**
 * Cross-host bootstrap helper.
 *
 * Both arya and coding-agent (and any future host) need the same wiring:
 *   - resolve XDG paths
 *   - load plugins from disk + npm
 *   - load skills, sub-agents, permissions
 *   - build a sessions store (jsonl by default, in-memory if asked)
 *   - build an approval queue
 *   - build the permission hook (per-primary-agent or from a permissions file)
 *   - build the tools (base + subagent dispatcher)
 *   - assemble the system prompt (primary agent body + skills block)
 *
 * What the host still owns:
 *   - the LLM provider plugin (it's host config)
 *   - the transport (TUI, WS, etc.)
 *   - the model state (which model is currently selected)
 *
 * Implementation is split into focused sibling factories under `./bootstrap/`:
 *   - `permissions.ts` — permissions config + approval queue + permission hook
 *   - `sessions.ts`    — session-store resolution
 *   - `tools.ts`       — plugin composition + tool filtering / subagent injection
 * This file is the orchestrator that wires the factories together.
 */
import { existsSync } from 'node:fs';
import { type CoreEvent, createBus, type EventBus, type Plugin, type SessionStore, type Tools } from 'mu-core';
import { type ApprovalQueue } from './approvals/queue';
import { buildPermissionsAndApprovals, type PermissionSource } from './bootstrap/permissions';
import { resolveSessionStore, type SessionStoreMode } from './bootstrap/sessions';
import { buildToolsAndSubagents } from './bootstrap/tools';
import { createXdgPaths, type XdgPaths } from './paths/xdg';
import type { createPermissionHook } from './permissions/hook';
import { loadPlugins } from './plugin-loader';
import { loadSkills } from './skills/loader';
import { formatSkillsForSystemPrompt } from './skills/system-prompt';
import { loadSubAgents } from './sub-agents/loader';
import { filterToolsByPrimary, pickPrimaryAgent } from './sub-agents/primary';
import type { SubAgent } from './sub-agents/types';

export type { PermissionSource, SessionStoreMode };

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
  /**
   * When provided, hooks + systemPrompt + tool filtering are dynamic: each turn
   * reads from this getter so the host can swap primary agents at runtime.
   * Use the returned `primaryAgents` to know which agents are switchable.
   *
   * Note: the static path (no `getActivePrimary`) is used by hosts that swap
   * permissions/system-prompt at construction time rather than per turn (e.g.
   * arya, which manages a single primary across the WS lifetime).
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

  // Resources from disk.
  const userPlugins = await loadPlugins({
    localDir: paths.pluginsDir,
    npmSpecs: opts.npmPlugins,
    trustFile: paths.pluginsTrustFile,
  });
  const subAgentsAll = loadSubAgents(subAgentsDirs);
  const skills = loadSkills(skillsDirs);
  const primaryAgents = subAgentsAll.filter((a) => a.type === 'primary');
  const primaryAgent = pickPrimaryAgent(subAgentsAll);
  const subAgents = subAgentsAll.filter((a) => a.type !== 'primary');
  const dynamic = Boolean(opts.getActivePrimary);
  const resolveActivePrimary = (): SubAgent | undefined =>
    dynamic ? opts.getActivePrimary!() ?? primaryAgent : primaryAgent;

  // Permissions + approvals + hook.
  const { approvalQueue, hook: permissionHook } = buildPermissionsAndApprovals({
    primaryAgent,
    dynamic,
    resolveActivePrimary,
    permissionsFiles,
    source: opts.permissionSource,
    defaultDecision: opts.defaultPermissionDecision,
  });

  // Session store.
  const store = resolveSessionStore(opts.sessionStore, paths.sessionsDir);

  // Bus.
  const bus = createBus<CoreEvent>();

  // Tools + plugins (filter base tools, inject subagent dispatcher).
  const { tools, plugins } = buildToolsAndSubagents({
    baseTools: opts.baseTools,
    providerPlugin: opts.providerPlugin,
    extraPlugins: opts.extraPlugins,
    userPlugins,
    subAgents,
    primaryAgent,
    approvalQueue,
    dynamic,
  });

  // System prompt — closes over the active primary so swapping affects
  // the next turn immediately.
  const systemPrompt = (): string | undefined => {
    const active = resolveActivePrimary();
    const primaryBlock = active?.prompt ?? '';
    const skillsBlock = formatSkillsForSystemPrompt(skills);
    const combined = [primaryBlock, skillsBlock].filter(Boolean).join('\n\n');
    return combined || undefined;
  };

  // Tool filter — in dynamic mode the active primary's allow-list hides
  // disallowed tools from the LLM entirely (no schema, no system prompt for them).
  const toolFilter: ((tools: Tools) => Tools) | undefined = dynamic
    ? (merged) => filterToolsByPrimary(merged, resolveActivePrimary())
    : undefined;

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
