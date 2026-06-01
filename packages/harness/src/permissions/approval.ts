import type { ContentPart } from 'mu-core';
import type { AgentSessionHooks } from '../hooks';

export interface ApprovalCall {
  id: string;
  name: string;
  input: unknown;
}

export interface RequireApprovalOptions {
  needsApproval(call: { name: string; input: unknown }): boolean;
  prompt(call: ApprovalCall): boolean | Promise<boolean>;
  onDeny?(call: ApprovalCall): ContentPart[];
  newId?(): string;
}

export const requireApproval = (options: RequireApprovalOptions): AgentSessionHooks => {
  const newId = options.newId ?? (() => crypto.randomUUID());
  return {
    beforeToolCall: async ({ name, input }) => {
      if (!options.needsApproval({ name, input })) return;
      const call: ApprovalCall = { id: newId(), name, input };
      if (await options.prompt(call)) return;
      return options.onDeny?.(call) ?? [{ type: 'text', text: `Denied: ${call.name}` }];
    },
  };
};
