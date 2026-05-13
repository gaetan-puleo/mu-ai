import type { ApprovalChannel, ApprovalDecision } from 'mu-agents';
import { getDispatch } from '../dispatchSlot';

/**
 * ApprovalChannel that opens an Ink modal. Reads the dispatch lazily from
 * the slot — if the TUI isn't mounted yet (or no TUI at all) the request
 * is rejected via deny so the gateway can fall through to its error path.
 */
export function createInkApprovalChannel(): ApprovalChannel {
  return {
    async request(req): Promise<ApprovalDecision> {
      const dispatch = getDispatch();
      if (!dispatch) return { outcome: 'deny' };
      return new Promise<ApprovalDecision>((resolve) => {
        dispatch({
          type: 'modal_open',
          modal: { kind: 'approval', req, resolve },
        });
      });
    },
  };
}
