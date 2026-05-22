/**
 * Bridge between mu-agents' `ApprovalChannel` (called from the turn loop) and
 * the Ink `ApprovalModal` (rendered in the React tree).
 *
 * The pattern mirrors `EXIT_BRIDGE` / `QUIT_BRIDGE` in tui.tsx: a singleton
 * slot the React component rebinds via `useEffect`. The channel pushes a
 * pending request; the modal calls `decide` on it; the original `request()`
 * promise resolves with the decision.
 *
 * This module is loaded at process startup (so the channel is available
 * when `Mu.start` registers mu-agents). Until `<Chat>` rebinds `push`, any
 * incoming request will throw — which is fine because tool calls cannot fire
 * before the UI mounts.
 */

import type { ApprovalChannel, ApprovalDecision, ApprovalRequest } from 'mu-agents';

export interface PendingApproval {
  request: ApprovalRequest;
  decide: (decision: ApprovalDecision) => void;
}

interface Bridge {
  push: ((pending: PendingApproval) => void) | null;
}

export const APPROVAL_BRIDGE: Bridge = { push: null };

export const tuiApprovalChannel: ApprovalChannel = {
  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const pending: PendingApproval = {
        request,
        decide: (decision) => resolve(decision),
      };
      if (!APPROVAL_BRIDGE.push) {
        // The TUI has not mounted yet. This should be unreachable in practice
        // — tool calls cannot fire before the first LLM stream resolves, which
        // is well after Ink finishes its first render. Treat as deny so the
        // turn doesn't deadlock.
        process.stderr.write('[mu] approval request before TUI mount; denying\n');
        resolve({ outcome: 'deny' });
        return;
      }
      APPROVAL_BRIDGE.push(pending);
    });
  },
};
