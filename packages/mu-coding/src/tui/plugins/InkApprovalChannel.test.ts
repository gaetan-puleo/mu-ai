import { describe, expect, it } from 'bun:test';
import type { ApprovalRequest } from 'mu-agents';
import { createInkApprovalChannel } from './InkApprovalChannel';
import { InkUIService } from './InkUIService';

function fakeRequest(extra?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'r1',
    token: 't1',
    agentId: 'build',
    toolName: 'bash',
    toolArgs: { cmd: 'echo hi' },
    channelId: 'tui',
    createdAt: 0,
    status: 'pending',
    ...extra,
  };
}

describe('InkApprovalChannel', () => {
  it('returns approved when user confirms', async () => {
    const ui = new InkUIService();
    const channel = createInkApprovalChannel(ui);
    const promise = channel.sendApprovalRequest(fakeRequest());
    // Resolve the dialog with `true` (approve).
    await new Promise((r) => setTimeout(r, 0));
    ui.resolveDialog(true);
    expect(await promise).toBe('approved');
  });

  it('returns denied when user declines', async () => {
    const ui = new InkUIService();
    const channel = createInkApprovalChannel(ui);
    const promise = channel.sendApprovalRequest(fakeRequest());
    await new Promise((r) => setTimeout(r, 0));
    ui.resolveDialog(false);
    expect(await promise).toBe('denied');
  });

  it('serialises tool args into the dialog message', async () => {
    const ui = new InkUIService();
    const channel = createInkApprovalChannel(ui);
    const promise = channel.sendApprovalRequest(fakeRequest({ toolArgs: { path: 'src/x.ts' } }));
    await new Promise((r) => setTimeout(r, 0));
    const dialog = ui.currentDialog();
    expect(dialog?.title).toBe('Run `bash`?');
    expect(dialog?.message).toContain('src/x.ts');
    ui.resolveDialog(true);
    await promise;
  });
});
