/**
 * Factory for the bootstrap-time permissions + approvals + hook trio.
 *
 * Resolves the `PermissionConfig` from one of three sources (primary agent,
 * permissions file, or none), creates the approval queue, and builds a
 * `BeforeToolHook` that gates tool calls — wiring the registry in static mode
 * or rebuilding it per-call in dynamic mode so swapping the active primary
 * immediately changes which rules apply.
 */
import { type ApprovalQueue, approvalQueueToPrompt, createApprovalQueue } from '../approvals/queue';
import { createPermissionHook } from '../permissions/hook';
import { loadPermissions } from '../permissions/loader';
import { createPermissionRegistry } from '../permissions/registry';
import type { PermissionConfig, PermissionDecision } from '../permissions/types';
import type { SubAgent } from '../sub-agents/types';

export type PermissionSource = 'primary-agent' | 'permissions-file' | 'none';

export interface BuildPermissionsAndApprovalsOptions {
  /** First primary agent picked at boot. Used to derive permissions in `primary-agent` mode. */
  primaryAgent: SubAgent | undefined;
  /** Whether the active primary can change per turn. */
  dynamic: boolean;
  /** Lazy lookup of the currently active primary (for dynamic mode). */
  resolveActivePrimary: () => SubAgent | undefined;
  /** Permissions files to consult in `permissions-file` mode (order = precedence). */
  permissionsFiles: string[];
  /** How permissions are resolved. Defaults to `primary-agent` if available, then `permissions-file`. */
  source?: PermissionSource;
  /** Override default decision when no permission rule matches. Defaults to `ask`. */
  defaultDecision?: PermissionDecision;
}

export interface PermissionsAndApprovals {
  permissionConfig: PermissionConfig;
  approvalQueue: ApprovalQueue;
  hook: ReturnType<typeof createPermissionHook>;
}

export function buildPermissionsAndApprovals(
  opts: BuildPermissionsAndApprovalsOptions,
): PermissionsAndApprovals {
  const { primaryAgent, dynamic, resolveActivePrimary, permissionsFiles } = opts;
  const source: PermissionSource = opts.source ?? (primaryAgent ? 'primary-agent' : 'permissions-file');
  const defaultDecision: PermissionDecision = opts.defaultDecision ?? 'ask';

  let permissionConfig: PermissionConfig;
  if (source === 'primary-agent' && primaryAgent) {
    permissionConfig = { rules: primaryAgent.permissions, default: defaultDecision };
  } else if (source === 'permissions-file') {
    permissionConfig = loadPermissions(permissionsFiles);
  } else {
    permissionConfig = { rules: [], default: defaultDecision };
  }

  const approvalQueue = createApprovalQueue();
  // Static path: one frozen registry from boot-time config.
  // Dynamic path: rebuild the registry per call so swapping the active primary
  // immediately changes which rules apply to the next tool call.
  const staticRegistry = createPermissionRegistry(permissionConfig);
  const hook = dynamic
    ? createPermissionHook({
      registry: {
        check(call) {
          const active = resolveActivePrimary();
          if (!active) return staticRegistry.check(call);
          // Tool filtering hides disallowed tools from the LLM entirely (via
          // toolFilter, see bootstrap); here we only need to evaluate the
          // active agent's permission rules.
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

  return { permissionConfig, approvalQueue, hook };
}
