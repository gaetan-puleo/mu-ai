import type { AgentSessionHooks } from '../hooks';
import { requireApproval } from './approval';

export type ApprovalAction = 'approve' | 'approve_always' | 'deny';

export interface PendingApproval {
  id: string;
  name: string;
  input: unknown;
}

export interface ApprovalManager {
  hooks: AgentSessionHooks;
  pending(): PendingApproval[];
  resolve(id: string, action: ApprovalAction): boolean;
  subscribe(listener: (req: PendingApproval) => void): () => void;
}

export interface ApprovalManagerOptions {
  needsApproval?: (call: { name: string; input: unknown }) => boolean;
  askTools?: string[];
  newId?: () => string;
}

export const createApprovalManager = (options: ApprovalManagerOptions = {}): ApprovalManager => {
  const askTools = options.askTools ? new Set(options.askTools) : undefined;
  const alwaysAllow = new Set<string>();
  const newId = options.newId ?? (() => crypto.randomUUID());
  const needs = options.needsApproval ?? (({ name }) => (askTools ? askTools.has(name) : true));

  const waiters = new Map<string, { resolve: (allow: boolean) => void; req: PendingApproval }>();
  const listeners = new Set<(req: PendingApproval) => void>();

  const hooks = requireApproval({
    needsApproval: (call) => needs(call) && !alwaysAllow.has(call.name),
    newId,
    prompt: (call) =>
      new Promise<boolean>((resolve) => {
        const req: PendingApproval = { id: call.id, name: call.name, input: call.input };
        waiters.set(call.id, { resolve, req });
        for (const listener of listeners) listener(req);
      }),
  });

  return {
    hooks,
    pending: () => [...waiters.values()].map((w) => w.req),
    resolve: (id, action) => {
      const waiter = waiters.get(id);
      if (!waiter) return false;
      waiters.delete(id);
      if (action === 'approve_always') alwaysAllow.add(waiter.req.name);
      waiter.resolve(action !== 'deny');
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
