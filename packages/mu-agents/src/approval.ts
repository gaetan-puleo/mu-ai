import { type ArgLine, newId, type Session, type ToolBlock, type ToolCall } from 'mu-core';
import type { Agent } from './markdown';
import { resolveAction } from './permissions';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  matchedRule: string;
  /** Pre-formatted lines from the tool's formatArgs. Undefined if tool didn't provide one. */
  argLines?: ArgLine[];
}

export interface ApprovalDecision {
  outcome: 'approve' | 'deny';
  /** Remember this rule for the rest of the session — skip future asks. */
  remember?: boolean;
}

export interface ApprovalChannel {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rememberKey(toolName: string, rule: string): string {
  return `${toolName}::${rule}`;
}

function blocked(content: string, error = true): ToolBlock {
  return { blocked: true, content, error };
}

export class ApprovalGateway {
  private remembered = new Map<string, Set<string>>(); // sessionId -> { "tool::rule" }

  constructor(private channel: ApprovalChannel | undefined) {}

  clearSession(sessionId: string): void {
    this.remembered.delete(sessionId);
  }

  /**
   * Decide what to do with a tool call given the active agent's permissions.
   * Returns the original call (allow), a ToolBlock (deny), or awaits the
   * approval channel (ask). Throws if `ask` fires with no channel registered.
   */
  async check(opts: {
    session: Session;
    agent: Agent;
    call: ToolCall;
    matchKey: string | undefined;
    argLines?: ArgLine[];
  }): Promise<ToolCall | ToolBlock> {
    const { session, agent, call, matchKey, argLines } = opts;
    const toolName = call.function.name;

    // No detailed permission map → defer to the simple allow-list.
    const perm = agent.permissions?.[toolName];
    if (!perm) {
      const inAllowList = agent.tools.includes('*') || agent.tools.includes(toolName);
      if (inAllowList) return call;
      return blocked(`Tool "${toolName}" is not available in the ${agent.name} agent.`);
    }

    const { action, rule } = resolveAction(perm, matchKey);

    if (action === 'allow') return call;
    if (action === 'deny') {
      return blocked(`Tool "${toolName}" blocked by ${agent.name}'s rule "${rule}".`);
    }

    // action === 'ask'
    const sessionApproved = this.remembered.get(session.id);
    if (sessionApproved?.has(rememberKey(toolName, rule))) return call;

    if (!this.channel) {
      throw new Error(
        `Tool "${toolName}" requires approval (rule "${rule}" on agent "${agent.name}") ` +
          'but no ApprovalChannel is registered.',
      );
    }

    const args = parseArgs(call.function.arguments);
    const decision = await this.channel.request({
      id: newId('approval'),
      sessionId: session.id,
      agentName: agent.name,
      toolName,
      args,
      matchedRule: rule,
      argLines,
    });

    if (decision.outcome === 'deny') {
      return blocked(`Tool "${toolName}" denied by user.`);
    }

    if (decision.remember) {
      let set = this.remembered.get(session.id);
      if (!set) {
        set = new Set();
        this.remembered.set(session.id, set);
      }
      set.add(rememberKey(toolName, rule));
    }

    return call;
  }
}
