/**
 * InkApprovalChannel — bridges the ApprovalGateway to the Ink confirm
 * dialog. Returns the user's choice synchronously (no token round-trip
 * through HTTP / Telegram); the gateway honours that immediate result.
 */

import type { ApprovalChannel, ApprovalRequest, ApprovalResult } from 'mu-agents';
import type { InkUIService } from './InkUIService';

function formatArgs(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    const json = JSON.stringify(args, null, 2);
    return json.length > 800 ? `${json.slice(0, 800)}…` : json;
  } catch {
    return String(args);
  }
}

export function createInkApprovalChannel(ui: InkUIService): ApprovalChannel {
  return {
    async sendApprovalRequest(req: ApprovalRequest): Promise<ApprovalResult | undefined> {
      const title = `Run \`${req.toolName}\`?`;
      const message = formatArgs(req.toolArgs);
      const ok = await ui.confirm(title, message);
      return ok ? 'approved' : 'denied';
    },
  };
}
