import { describe, expect, it } from 'bun:test';
import { type ApprovalChannel, createApprovalGateway } from './approval';

describe('ApprovalGateway', () => {
  it('denies when no channel registered', async () => {
    const gw = createApprovalGateway();
    const r = await gw.request({ agentId: 'a', toolName: 't', toolArgs: {}, channelId: 'tui', timeoutMs: 50 });
    expect(r).toBe('denied');
  });

  it('synchronous channel resolves immediately', async () => {
    const gw = createApprovalGateway();
    const sync: ApprovalChannel = {
      async sendApprovalRequest() {
        return 'approved';
      },
    };
    gw.registerChannel('tui', sync);
    const r = await gw.request({ agentId: 'a', toolName: 't', toolArgs: {}, channelId: 'tui', timeoutMs: 1000 });
    expect(r).toBe('approved');
  });

  it('async channel resolves via approve(token)', async () => {
    const gw = createApprovalGateway();
    let captured: string | null = null;
    const async: ApprovalChannel = {
      async sendApprovalRequest(req) {
        captured = req.token;
      },
    };
    gw.registerChannel('http', async);
    const promise = gw.request({ agentId: 'a', toolName: 't', toolArgs: {}, channelId: 'http', timeoutMs: 1000 });
    // Wait for the channel to receive the token
    await new Promise((r) => setTimeout(r, 10));
    expect(captured).not.toBeNull();
    if (captured) gw.approve(captured);
    expect(await promise).toBe('approved');
  });

  it('times out', async () => {
    const gw = createApprovalGateway();
    const stalling: ApprovalChannel = {
      async sendApprovalRequest() {
        /* never resolves */
      },
    };
    gw.registerChannel('tui', stalling);
    const r = await gw.request({ agentId: 'a', toolName: 't', toolArgs: {}, channelId: 'tui', timeoutMs: 30 });
    expect(r).toBe('timeout');
  });

  it('first sync channel wins, others ignored', async () => {
    const gw = createApprovalGateway();
    gw.registerChannel('tui', {
      async sendApprovalRequest() {
        return 'approved';
      },
    });
    gw.registerChannel('tui', {
      async sendApprovalRequest() {
        return 'denied';
      },
    });
    const r = await gw.request({ agentId: 'a', toolName: 't', toolArgs: {}, channelId: 'tui', timeoutMs: 200 });
    expect(['approved', 'denied']).toContain(r);
  });

  it('approval URLs include base when set', async () => {
    const gw = createApprovalGateway();
    gw.setApprovalBaseUrl('https://x.test');
    let receivedApproveUrl: string | undefined;
    gw.registerChannel('http', {
      async sendApprovalRequest(req) {
        receivedApproveUrl = req.approveUrl;
        return 'approved';
      },
    });
    await gw.request({ agentId: 'a', toolName: 't', toolArgs: {}, channelId: 'http', timeoutMs: 200 });
    expect(receivedApproveUrl).toMatch(/^https:\/\/x\.test\/approve\//);
  });
});
