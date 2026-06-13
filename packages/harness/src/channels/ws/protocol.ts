import type { PersistedSessionWire, SessionSummaryWire } from './session-service';
import type { WireAttachment, WireMessage } from './wire';
import type { ApprovalAction, PendingApproval } from '../../permissions';
import type { Message, Usage } from 'mu-core';

export interface WireModel {
  id: string;
  ownedBy?: string;
}

export type WsInbound =
  | { type: 'chat'; sessionId?: string; text: string; attachments?: WireAttachment[] }
  | { type: 'command'; sessionId?: string; text: string }
  | { type: 'commands' }
  | { type: 'agents' }
  | { type: 'approval_response'; requestId: string; action: ApprovalAction }
  | { type: 'set_active_agent'; agentId: string; sessionId?: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'models:list' }
  | { type: 'models:select'; ref: string }
  | { type: 'subagent:dispatch'; requestId: string; agent: string; task: string; parentId: string }
  | { type: 'sessions:list' }
  | { type: 'sessions:create'; sessionId?: string; title?: string }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'sessions:rename'; sessionId: string; title: string }
  | { type: 'sessions:fork'; requestId: string; sessionId: string; upToIndex: number }
  | { type: 'sessions:get'; sessionId: string };

const APPROVAL_ACTIONS = new Set<ApprovalAction>(['approve', 'approve_always', 'deny']);

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function parseAttachments(v: unknown): WireAttachment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: WireAttachment[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if ((a.kind === 'image' || a.kind === 'audio') && typeof a.mime === 'string' && typeof a.data === 'string') {
      out.push({ kind: a.kind, mime: a.mime, data: a.data });
    }
  }
  return out.length > 0 ? out : undefined;
}

export function parseInbound(raw: unknown): WsInbound | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';

  switch (type) {
    case 'chat': {
      if (typeof o.text !== 'string') return { error: 'chat requires text:string' };
      const attachments = parseAttachments(o.attachments);
      return { type: 'chat', sessionId: optionalString(o.sessionId), text: o.text, ...(attachments ? { attachments } : {}) };
    }
    case 'command': {
      if (typeof o.text !== 'string') return { error: 'command requires text:string' };
      return { type: 'command', sessionId: optionalString(o.sessionId), text: o.text };
    }
    case 'commands':
      return { type: 'commands' };
    case 'agents':
      return { type: 'agents' };
    case 'approval_response': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : typeof o.token === 'string' ? o.token : '';
      if (!requestId) return { error: 'approval_response requires requestId or token' };
      const actionRaw = typeof o.action === 'string' ? o.action : '';
      const action: ApprovalAction = APPROVAL_ACTIONS.has(actionRaw as ApprovalAction)
        ? (actionRaw as ApprovalAction)
        : 'deny';
      return { type: 'approval_response', requestId, action };
    }
    case 'set_active_agent': {
      const agentId = typeof o.agentId === 'string' ? o.agentId : '';
      if (!agentId) return { error: 'set_active_agent requires agentId' };
      return { type: 'set_active_agent', agentId, sessionId: optionalString(o.sessionId) };
    }
    case 'abort': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'abort requires sessionId' };
      return { type: 'abort', sessionId: o.sessionId };
    }
    case 'models:list':
      return { type: 'models:list' };
    case 'models:select': {
      if (typeof o.ref !== 'string' || !o.ref) return { error: 'models:select requires ref:string' };
      return { type: 'models:select', ref: o.ref };
    }
    case 'subagent:dispatch': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      const agent = typeof o.agent === 'string' ? o.agent : '';
      const task = typeof o.task === 'string' ? o.task : '';
      if (!requestId || !agent || !task) {
        return { error: 'subagent:dispatch requires requestId, agent, task' };
      }
      return { type: 'subagent:dispatch', requestId, agent, task, parentId: optionalString(o.parentId) ?? '' };
    }
    case 'sessions:list':
      return { type: 'sessions:list' };
    case 'sessions:create':
      return { type: 'sessions:create', sessionId: optionalString(o.sessionId), title: optionalString(o.title) };
    case 'sessions:delete': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:delete requires sessionId' };
      return { type: 'sessions:delete', sessionId: o.sessionId };
    }
    case 'sessions:rename': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:rename requires sessionId' };
      return { type: 'sessions:rename', sessionId: o.sessionId, title: String(o.title ?? '') };
    }
    case 'sessions:fork': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      if (!requestId) return { error: 'sessions:fork requires requestId' };
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:fork requires sessionId' };
      const upToIndex = typeof o.upToIndex === 'number' && Number.isInteger(o.upToIndex) ? o.upToIndex : -1;
      if (upToIndex < 0) return { error: 'sessions:fork requires upToIndex:int>=0' };
      return { type: 'sessions:fork', requestId, sessionId: o.sessionId, upToIndex };
    }
    case 'sessions:get': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:get requires sessionId' };
      return { type: 'sessions:get', sessionId: o.sessionId };
    }
    default:
      return { error: `unknown message type: ${type || '<empty>'}` };
  }
}

export interface WireAgent {
  name: string;
  description: string;
  color?: string;
}

export interface WireCommand {
  command: string;
  description: string;
}

export type WireSessionChangeKind = 'created' | 'updated' | 'deleted' | 'renamed';

export interface WireRule {
  tool: string;
  argsPattern?: string;
  decision: 'allow' | 'deny' | 'ask';
}

export interface WireApprovalRequest {
  type: 'approval_request';
  requestId: string;
  sessionId: string | null;
  toolName: string;
  args: string;
  matchedRule: WireRule | undefined;
}

export interface SubAgentToolCallDetail {
  name?: string;
  arguments?: string;
}

export interface SubAgentToolResultDetail {
  name?: string;
  content?: string;
  error?: boolean;
}

export type SubAgentEventWire =
  | { runId: string; parentSessionId: string; agentName: string; type: 'started'; detail?: { task?: string } }
  | { runId: string; parentSessionId: string; agentName: string; type: 'content'; detail?: string }
  | { runId: string; parentSessionId: string; agentName: string; type: 'tool_call'; detail?: SubAgentToolCallDetail }
  | {
    runId: string;
    parentSessionId: string;
    agentName: string;
    type: 'tool_result';
    detail?: SubAgentToolResultDetail;
  }
  | { runId: string; parentSessionId: string; agentName: string; type: 'completed'; detail?: { content?: string } }
  | { runId: string; parentSessionId: string; agentName: string; type: 'error'; detail?: string };

export interface WireSchedulerTask {
  id: string;
  cron: string;
  prompt: string;
  timezone?: string;
  channel?: string;
}

export type WireSchedulerEvent =
  | { type: 'task_started'; task: WireSchedulerTask; at: number }
  | { type: 'task_completed'; task: WireSchedulerTask; at: number; durationMs: number }
  | { type: 'task_failed'; task: WireSchedulerTask; at: number; error: string };

export type WsOutbound =
  | { type: 'commands'; commands: WireCommand[] }
  | { type: 'capabilities'; vision: boolean; audio: boolean }
  | { type: 'model_loading'; model: string; loading: boolean }
  | { type: 'agents'; agents: WireAgent[]; activeAgentId?: string | null }
  | { type: 'active_agent'; agentId: string | null; sessionId?: string; reason?: string }
  | { type: 'stream'; sessionId: string; text: string }
  | { type: 'reasoning'; sessionId: string; text: string }
  | { type: 'turn_start'; sessionId: string }
  | { type: 'turn_end'; sessionId: string; reason?: 'complete' | 'aborted' | 'error' }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'message'; sessionId: string; message: WireMessage }
  | { type: 'models:listed'; models: WireModel[]; selected: string }
  | { type: 'subagent:result'; requestId: string; agent: string; text: string }
  | { type: 'subagent:error'; requestId: string; message: string }
  | { type: 'sessions:listed'; sessions: SessionSummaryWire[] }
  | { type: 'sessions:changed'; sessionId: string; kind: WireSessionChangeKind }
  | { type: 'sessions:history'; sessionId: string; session: PersistedSessionWire | null }
  | { type: 'sessions:raw'; sessionId: string; messages: Message[] }
  | { type: 'sessions:forked'; requestId: string; sessionId: string; messages: Message[] }
  | WireApprovalRequest
  | { type: 'scheduler_event'; event: WireSchedulerEvent }
  | { type: 'sub_agent_event'; event: SubAgentEventWire }
  | { type: 'error'; sessionId?: string; message: string };

export function approvalRequestToWire(req: PendingApproval, sessionId: string | null): WireApprovalRequest {
  return {
    type: 'approval_request',
    requestId: req.id,
    sessionId,
    toolName: req.name,
    args: JSON.stringify(req.input ?? {}),
    matchedRule: undefined,
  };
}
