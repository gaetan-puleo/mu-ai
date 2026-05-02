import { describe, expect, it } from 'bun:test';
import type { PluginRegistryView, ToolCall } from 'mu-core';
import { createApprovalGateway } from './approval';
import { enforceAgentPermissions } from './permissionGate';
import type { AgentDefinition } from './types';

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: 'tc',
    function: { name, arguments: JSON.stringify(args) },
  };
}

const REGISTRY_STUB: PluginRegistryView = {
  getTools: () => [],
  getFilteredTools: async () => [],
  getHooks: () => [],
  getSystemPrompts: async () => [],
  applySystemPromptTransforms: async (p) => p,
  getProviders: () => undefined,
};

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'sub',
    description: '',
    tools: [],
    systemPrompt: '',
    type: 'subagent',
    ...overrides,
  };
}

describe('enforceAgentPermissions', () => {
  it('allows tools listed in the legacy whitelist when no permission map', async () => {
    const result = await enforceAgentPermissions({
      agent: agent({ tools: ['bash'] }),
      registry: REGISTRY_STUB,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      call: call('bash'),
    });
    expect(result).toEqual(call('bash'));
  });

  it('blocks tools not in the whitelist (legacy)', async () => {
    const result = await enforceAgentPermissions({
      agent: agent({ tools: ['read'] }),
      registry: REGISTRY_STUB,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      call: call('bash'),
    });
    expect('blocked' in result && result.blocked).toBe(true);
  });

  it('returns deny result when permission map says deny', async () => {
    const result = await enforceAgentPermissions({
      agent: agent({ tools: ['bash'], permissions: { bash: 'deny' } }),
      registry: REGISTRY_STUB,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      call: call('bash'),
    });
    expect('blocked' in result && result.blocked).toBe(true);
  });

  it('routes ask through the approval gateway', async () => {
    const gw = createApprovalGateway();
    gw.registerChannel('tui', {
      async sendApprovalRequest() {
        return 'approved';
      },
    });
    const result = await enforceAgentPermissions({
      agent: agent({ tools: ['bash'], permissions: { bash: 'ask' } }),
      registry: REGISTRY_STUB,
      approvalGateway: gw,
      approvalChannelId: 'tui',
      call: call('bash'),
    });
    expect(result).toEqual(call('bash'));
  });

  it('blocks when ask is denied', async () => {
    const gw = createApprovalGateway();
    gw.registerChannel('tui', {
      async sendApprovalRequest() {
        return 'denied';
      },
    });
    const result = await enforceAgentPermissions({
      agent: agent({ tools: ['bash'], permissions: { bash: 'ask' } }),
      registry: REGISTRY_STUB,
      approvalGateway: gw,
      approvalChannelId: 'tui',
      call: call('bash'),
    });
    expect('blocked' in result && result.blocked).toBe(true);
  });
});
