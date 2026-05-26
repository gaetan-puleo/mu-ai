/**
 * Generic approval queue. Permission hook calls `request(...)`, transport
 * (WS, TUI, etc.) subscribes to pending requests and calls `resolve(id, ...)`
 * once the user decides. Promises returned by `request` resolve at that point.
 *
 * Wire to `createPermissionHook` via `approvalQueueToPrompt(queue)`.
 */
import { randomUUID } from 'node:crypto';
import type { PermissionRule } from '../permissions/types';
import type { PermissionPrompt } from '../permissions/hook';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: string;
  matchedRule?: PermissionRule;
  createdAt: number;
}

export type ApprovalDecision = 'allow' | 'deny';

export interface ApprovalQueue {
  /** Called by the permission hook when the registry decision is `ask`. */
  request(toolName: string, args: string, matchedRule?: PermissionRule): Promise<ApprovalDecision>;
  /** Called by the transport when the user has decided. */
  resolve(id: string, decision: ApprovalDecision): void;
  /** Snapshot of all pending requests (e.g. for a freshly connected client). */
  pending(): ApprovalRequest[];
  /** Listen for new pending requests. */
  subscribe(listener: (req: ApprovalRequest) => void): () => void;
}

export function createApprovalQueue(): ApprovalQueue {
  const pendingMap = new Map<string, { req: ApprovalRequest; resolve: (decision: ApprovalDecision) => void }>();
  const listeners = new Set<(req: ApprovalRequest) => void>();

  return {
    request(toolName, args, matchedRule) {
      return new Promise<ApprovalDecision>((resolve) => {
        const id = randomUUID();
        const req: ApprovalRequest = { id, toolName, args, matchedRule, createdAt: Date.now() };
        pendingMap.set(id, { req, resolve });
        for (const fn of listeners) {
          try {
            fn(req);
          } catch (err) {
            console.error('[mu-harness/approvals] listener threw:', err);
          }
        }
      });
    },

    resolve(id, decision) {
      const entry = pendingMap.get(id);
      if (!entry) return;
      pendingMap.delete(id);
      entry.resolve(decision);
    },

    pending() {
      return [...pendingMap.values()].map((e) => e.req);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Convert an approval queue into a `PermissionPrompt` for `createPermissionHook`. */
export function approvalQueueToPrompt(queue: ApprovalQueue): PermissionPrompt {
  return (call, matched) => queue.request(call.tool, call.args, matched);
}
