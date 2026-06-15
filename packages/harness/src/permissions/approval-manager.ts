import type { ContentPart } from 'mu-core';
import type { AgentSessionHooks } from '../hooks';

export type ApprovalAction = 'approve' | 'approve_always' | 'deny';
export type ApprovalDecision = 'allow' | 'ask' | 'deny';

export interface PendingApproval {
  id: string;
  name: string;
  input: unknown;
  agent?: string;
}

export interface ApprovalManager {
  hooks: AgentSessionHooks;
  hooksFor(opts: {
    decide(call: { name: string; input: unknown }): ApprovalDecision;
    agent?(): string | undefined;
  }): AgentSessionHooks;
  pending(): PendingApproval[];
  resolve(id: string, action: ApprovalAction): boolean;
  subscribe(listener: (req: PendingApproval) => void): () => void;
}

export interface ApprovalManagerOptions {
  needsApproval?: (call: { name: string; input: unknown }) => boolean;
  askTools?: string[];
  newId?: () => string;
}

const denied = (name: string): ContentPart[] => [{ type: 'text', text: `Denied: ${name}` }];

export const createApprovalManager = (options: ApprovalManagerOptions = {}): ApprovalManager => {
  const askTools = options.askTools ? new Set(options.askTools) : undefined;
  const alwaysAllow = new Set<string>();
  const newId = options.newId ?? (() => crypto.randomUUID());
  const keyOf = (agent: string | undefined, tool: string): string => `${agent ?? ''}:${tool}`;

  const waiters = new Map<string, { resolve: (allow: boolean) => void; req: PendingApproval; key: string }>();
  const listeners = new Set<(req: PendingApproval) => void>();

  const request = (id: string, name: string, input: unknown, agent: string | undefined): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const req: PendingApproval = { id, name, input, agent };
      waiters.set(id, { resolve, req, key: keyOf(agent, name) });
      for (const listener of listeners) listener(req);
    });

  const defaultNeeds = options.needsApproval ?? (({ name }) => (askTools ? askTools.has(name) : true));

  const hooksFor: ApprovalManager['hooksFor'] = ({ decide, agent }) => ({
    beforeToolCall: async (call) => {
      const decision = decide(call);
      if (decision === 'allow') return;
      const agentName = agent?.();
      if (decision === 'deny') return denied(call.name);
      if (alwaysAllow.has(keyOf(agentName, call.name))) return;
      const allow = await request(newId(), call.name, call.input, agentName);
      return allow ? undefined : denied(call.name);
    },
  });

  // Default hooks (no per-agent policy): ask for every tool that needs approval, allow the
  // rest. Defined via hooksFor so the beforeToolCall flow lives in exactly one place.
  const hooks = hooksFor({ decide: (call) => (defaultNeeds(call) ? 'ask' : 'allow') });

  return {
    hooks,
    hooksFor,
    pending: () => [...waiters.values()].map((w) => w.req),
    resolve: (id, action) => {
      const waiter = waiters.get(id);
      if (!waiter) return false;
      waiters.delete(id);
      if (action === 'approve_always') alwaysAllow.add(waiter.key);
      waiter.resolve(action !== 'deny');
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
