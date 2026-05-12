/**
 * ApprovalGateway — central broker for `ask` permission decisions. Tools
 * (or the agent loop) request approval; channels (Ink dialog, Telegram
 * inline keyboard, HTTP server, …) resolve them either synchronously
 * (returning the result from `sendApprovalRequest`) or asynchronously (by
 * calling `gateway.approve(token)` / `gateway.deny(token)` on a callback).
 *
 * Multiple channels can be registered for one channelId; the first one to
 * resolve wins; the rest are ignored.
 *
 * State surface: the gateway also keeps each request's snapshot around
 * after resolution (until `clearSnapshot` is called or the retention
 * window expires) so channel hosts can push wire snapshots and
 * reconnecting clients can bootstrap the current state.
 */

import { prettyToolArgs } from 'mu-core';

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

/**
 * Wire-shape snapshot of one approval. Channel hosts push this so
 * clients render state directly without a client-side reducer.
 */
export interface ApprovalSnapshot {
  approvalId: string;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  toolName: string;
  toolArgs: unknown;
  toolArgsPretty: string;
  agentId: string;
  channelId: string;
  createdAt: number;
  resolvedAt?: number;
}

export type ApprovalSnapshotListener = (snapshot: ApprovalSnapshot) => void;

export interface ApprovalGateway {
  request: (input: ApprovalGatewayRequestInput) => Promise<ApprovalResult>;
  registerChannel: (channelId: string, channel: ApprovalChannel) => () => void;
  approve: (token: string) => void;
  deny: (token: string) => void;
  setApprovalBaseUrl: (url: string) => void;
  /** Current snapshot for an approval, or undefined when unknown / expired. */
  getSnapshot: (approvalId: string) => ApprovalSnapshot | undefined;
  /** Every pending + recently-resolved snapshot, oldest → newest. */
  listSnapshots: () => ApprovalSnapshot[];
  /** Subscribe to snapshot transitions. Fires once per existing snapshot on subscribe (replay). */
  subscribeAllSnapshots: (listener: ApprovalSnapshotListener) => () => void;
}

interface PendingEntry {
  resolve: (r: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function genToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Window during which a resolved snapshot stays queryable. */
const SNAPSHOT_RETENTION_MS = 5 * 60_000;

function buildSnapshot(req: ApprovalRequest, resolvedAt?: number): ApprovalSnapshot {
  return {
    approvalId: req.id,
    status: req.status,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    toolArgsPretty: prettyToolArgs(req.toolArgs),
    agentId: req.agentId,
    channelId: req.channelId,
    createdAt: req.createdAt,
    ...(resolvedAt !== undefined ? { resolvedAt } : {}),
  };
}

export function createApprovalGateway(): ApprovalGateway {
  const channels = new Map<string, Set<ApprovalChannel>>();
  const pending = new Map<string, PendingEntry>();
  const requests = new Map<string, ApprovalRequest>();
  const order: string[] = [];
  const snapshotListeners = new Set<ApprovalSnapshotListener>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let baseUrl: string | undefined;

  function emit(req: ApprovalRequest, resolvedAt?: number): void {
    const snap = buildSnapshot(req, resolvedAt);
    for (const fn of snapshotListeners) {
      try {
        fn(snap);
      } catch {
        // Listener errors must not break the gateway.
      }
    }
  }

  function scheduleExpiry(token: string): void {
    const t = setTimeout(() => {
      requests.delete(token);
      const idx = order.indexOf(token);
      if (idx >= 0) order.splice(idx, 1);
      expiryTimers.delete(token);
    }, SNAPSHOT_RETENTION_MS);
    expiryTimers.set(token, t);
  }

  function resolve(token: string, result: ApprovalResult): void {
    const entry = pending.get(token);
    if (!entry) return;
    pending.delete(token);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(result);
    const req = requests.get(token);
    if (req) {
      req.status = result;
      emit(req, Date.now());
      scheduleExpiry(token);
    }
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
      requests.set(token, req);
      order.push(token);
      emit(req);

      return new Promise<ApprovalResult>((res) => {
        const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          if (pending.has(token)) {
            pending.delete(token);
            const r = requests.get(token);
            if (r) {
              r.status = 'timeout';
              emit(r, Date.now());
              scheduleExpiry(token);
            }
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
    getSnapshot(approvalId) {
      const req = requests.get(approvalId);
      if (!req) return undefined;
      return buildSnapshot(req, req.status === 'pending' ? undefined : Date.now());
    },
    listSnapshots() {
      return order
        .map((id) => requests.get(id))
        .filter((r): r is ApprovalRequest => Boolean(r))
        .map((r) => buildSnapshot(r, r.status === 'pending' ? undefined : undefined));
    },
    subscribeAllSnapshots(listener) {
      snapshotListeners.add(listener);
      // Replay existing snapshots.
      for (const id of order) {
        const r = requests.get(id);
        if (r) {
          try {
            listener(buildSnapshot(r));
          } catch {
            // ignore
          }
        }
      }
      return () => {
        snapshotListeners.delete(listener);
      };
    },
  };
}
