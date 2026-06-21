import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider, Tool } from 'mu-core';
import {
  type Agent,
  type ApprovalAction,
  createApprovalManager,
  createHarness,
  type HarnessOptions,
  type PendingApproval,
  toolDecision,
  type XdgDirs,
} from 'mu-harness';
import { isReadOnlyBash } from './bash-safety';

type AgentDecide = NonNullable<HarnessOptions['approvals']>['decide'];

const tempXdg = (): { xdg: XdgDirs; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'mu-approval-'));
  return { dir, xdg: { configHome: join(dir, 'config'), dataHome: join(dir, 'data'), stateHome: join(dir, 'state') } };
};

const callThenText = (name: string, input: unknown): Provider => {
  let turn = 0;
  return {
    async *stream() {
      if (turn++ === 0) yield { type: 'tool_call', id: 'c1', name, input };
      else yield { type: 'text', text: 'done' };
    },
  };
};

const tool = (name: string, onRun: () => void): Tool => ({
  name,
  description: name,
  prompt: '',
  parameters: { type: 'object' },
  run: () => {
    onRun();
    return Promise.resolve([{ type: 'text', text: 'ok' }]);
  },
});

const run = async (
  agent: Agent,
  toolName: string,
  onPrompt: (req: PendingApproval) => ApprovalAction,
  opts: { input?: unknown; decide?: AgentDecide } = {},
): Promise<{ ran: number; seen: PendingApproval[] }> => {
  const { dir, xdg } = tempXdg();
  let ran = 0;
  const approvals = createApprovalManager();
  const harness = await createHarness({
    hostName: 'mu-test',
    xdg,
    providers: { local: callThenText(toolName, opts.input ?? { path: 'x' }) },
    model: 'local/test-model',
    tools: [tool(toolName, () => ran++)],
    system: 'You are a test.',
    title: false,
    approvals: { manager: approvals, activeAgent: () => agent, decide: opts.decide },
  });
  const seen: PendingApproval[] = [];
  approvals.subscribe((req) => {
    seen.push(req);
    approvals.resolve(req.id, onPrompt(req));
  });
  try {
    await harness.sessions.create().send('go');
    return { ran, seen };
  } finally {
    harness.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

const buildAgent: Agent = {
  name: 'build',
  description: '',
  prompt: 'p',
  tools: { '*': 'allow', write: 'ask', secret: 'deny' },
};

describe('coding-agent agent-driven approval', () => {
  it('prompts for an "ask" tool and runs it when approved, stamped with the agent', async () => {
    const { ran, seen } = await run(buildAgent, 'write', () => 'approve');
    expect(seen.length).toBe(1);
    expect(seen[0].name).toBe('write');
    expect(seen[0].agent).toBe('build');
    expect(ran).toBe(1);
  });

  it('blocks an "ask" tool when denied', async () => {
    const { ran, seen } = await run(buildAgent, 'write', () => 'deny');
    expect(seen.length).toBe(1);
    expect(ran).toBe(0);
  });

  it('hard-blocks a "deny" tool without ever prompting', async () => {
    const { ran, seen } = await run(buildAgent, 'secret', () => 'approve');
    expect(seen.length).toBe(0);
    expect(ran).toBe(0);
  });

  it('does not prompt for an "allow" tool', async () => {
    const { ran, seen } = await run(buildAgent, 'read', () => 'approve');
    expect(seen.length).toBe(0);
    expect(ran).toBe(1);
  });
});

const bashAgent: Agent = { name: 'build', description: '', prompt: 'p', tools: { '*': 'ask' } };

const bashDecide: AgentDecide = (agent, call) => {
  const decision = toolDecision(agent, call.name);
  if (call.name === 'bash' && decision === 'ask' && isReadOnlyBash(call.input)) return 'allow';
  return decision;
};

describe('coding-agent bash side-effect gating (decideTool)', () => {
  it('runs a read-only bash command without prompting', async () => {
    const { ran, seen } = await run(bashAgent, 'bash', () => 'deny', {
      input: { cmd: 'grep -rn foo src' },
      decide: bashDecide,
    });
    expect(seen.length).toBe(0);
    expect(ran).toBe(1);
  });

  it('prompts for a bash command with side effects', async () => {
    const { ran, seen } = await run(bashAgent, 'bash', () => 'deny', {
      input: { cmd: 'rm -rf build' },
      decide: bashDecide,
    });
    expect(seen.length).toBe(1);
    expect(ran).toBe(0);
  });
});
