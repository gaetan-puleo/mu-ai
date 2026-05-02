/**
 * ApprovalGateway — central broker for `ask` permission decisions. Tools
 * (or the agent loop) request approval; channels (Ink dialog, Telegram
 * inline keyboard, HTTP server, …) resolve them either synchronously
 * (returning the result from `sendApprovalRequest`) or asynchronously (by
 * calling `gateway.approve(token)` / `gateway.deny(token)` on a callback).
 *
 * Multiple channels can be registered for one channelId; the first one to
 * resolve wins; the rest are ignored.
 */

export interface ApprovalRequest {
  id: string;
  token: string;
  agentId: string;
  toolName: string;
  toolArgs: unknown;
  channelId: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  approveUrl?: string;
  denyUrl?: string;
}

export type ApprovalResult = 'approved' | 'denied' | 'timeout';

export interface ApprovalChannel {
  /**
   * Either resolve synchronously by returning a result, or return `undefined`
   * to defer to `gateway.approve(token)` / `gateway.deny(token)` (HTTP,
   * Telegram).
   */
  sendApprovalRequest: (request: ApprovalRequest) => Promise<ApprovalResult | undefined>;
}

export interface ApprovalGatewayRequestInput {
  agentId: string;
  toolName: string;
  toolArgs: unknown;
  channelId: string;
  timeoutMs?: number;
}

export interface ApprovalGateway {
  request: (input: ApprovalGatewayRequestInput) => Promise<ApprovalResult>;
  registerChannel: (channelId: string, channel: ApprovalChannel) => () => void;
  approve: (token: string) => void;
  deny: (token: string) => void;
  setApprovalBaseUrl: (url: string) => void;
}

interface PendingEntry {
  resolve: (r: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function genToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createApprovalGateway(): ApprovalGateway {
  const channels = new Map<string, Set<ApprovalChannel>>();
  const pending = new Map<string, PendingEntry>();
  let baseUrl: string | undefined;

  function resolve(token: string, result: ApprovalResult): void {
    const entry = pending.get(token);
    if (!entry) return;
    pending.delete(token);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(result);
  }

  return {
    registerChannel(channelId, channel) {
      let set = channels.get(channelId);
      if (!set) {
        set = new Set();
        channels.set(channelId, set);
      }
      set.add(channel);
      return () => {
        set?.delete(channel);
        if (set && set.size === 0) channels.delete(channelId);
      };
    },
    approve(token) {
      resolve(token, 'approved');
    },
    deny(token) {
      resolve(token, 'denied');
    },
    setApprovalBaseUrl(url) {
      baseUrl = url;
    },
    async request(input) {
      const set = channels.get(input.channelId);
      if (!set || set.size === 0) {
        // No channel listening — fail closed.
        return 'denied';
      }
      const token = genToken();
      const id = token;
      const req: ApprovalRequest = {
        id,
        token,
        agentId: input.agentId,
        toolName: input.toolName,
        toolArgs: input.toolArgs,
        channelId: input.channelId,
        createdAt: Date.now(),
        status: 'pending',
        approveUrl: baseUrl ? `${baseUrl}/approve/${token}` : undefined,
        denyUrl: baseUrl ? `${baseUrl}/deny/${token}` : undefined,
      };

      return new Promise<ApprovalResult>((res) => {
        const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          if (pending.has(token)) {
            pending.delete(token);
            res('timeout');
          }
        }, timeoutMs);
        pending.set(token, { resolve: res, timer });

        // Fire all channels in parallel; first sync result wins, others ignored.
        for (const channel of set) {
          Promise.resolve()
            .then(() => channel.sendApprovalRequest(req))
            .then((maybeResult) => {
              if (maybeResult && pending.has(token)) {
                resolve(token, maybeResult);
              }
            })
            .catch(() => {
              // Channel error — leave pending; other channels or timeout decide.
            });
        }
      });
    },
  };
}
