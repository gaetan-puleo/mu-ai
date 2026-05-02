/**
 * End-to-end tests for `runSubagent`. The provider stub yields a fixed
 * assistant content chunk, so a successful run lands on the SubagentRun
 * registry as `status: 'done'` with `finalContent` populated.
 *
 * The first test pins down the `getProviders` regression: prior to the
 * fix, the shimmed registry omitted `getProviders` and `runAgent` threw
 * "No provider registered" the moment it tried to stream.
 */

import { describe, expect, it } from 'bun:test';
import {
  type ChatMessage,
  createProviderRegistry,
  type PluginRegistryView,
  type ProviderConfig,
  type StreamChunk,
} from 'mu-core';
import { createApprovalGateway } from './approval';
import { runSubagent } from './subagent';
import { createSubagentRunRegistry } from './subagentRun';
import type { AgentDefinition } from './types';

function fakeProviders() {
  const providers = createProviderRegistry();
  providers.register({
    id: 'openai',
    async *streamChat(): AsyncIterable<StreamChunk> {
      yield { type: 'content', text: 'hello from subagent' };
    },
    async listModels() {
      return [];
    },
  });
  return providers;
}

function makeRegistryView(getProviders: () => ReturnType<typeof fakeProviders> | undefined): PluginRegistryView {
  return {
    getTools: () => [],
    getFilteredTools: async () => [],
    getHooks: () => [],
    getSystemPrompts: async () => [],
    applySystemPromptTransforms: async (p) => p,
    getProviders,
  };
}

const AGENT: AgentDefinition = {
  name: 'review',
  description: 'review',
  tools: ['*'],
  systemPrompt: 'You are review.',
  type: 'subagent',
};

const CONFIG: ProviderConfig = { providerId: 'openai' };

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: scenario test suite — each `it` runs `runSubagent` end-to-end with unique fakes; hoisting would lose per-case mutation flexibility.
describe('runSubagent', () => {
  it('completes via the host provider registry (regression: missing getProviders)', async () => {
    const providers = fakeProviders();
    const view = makeRegistryView(() => providers);
    const runs = createSubagentRunRegistry();
    const result = await runSubagent({
      agent: AGENT,
      task: 'do it',
      config: CONFIG,
      model: 'gpt',
      registry: view,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      runRegistry: runs,
    });
    expect(result.error).toBe(false);
    // Dispatcher-facing return is wrapped with an attribution header so the
    // parent agent quotes findings as the subagent's work, and a trailing
    // footer that instructs the parent to relay the findings *and continue*
    // working on the original task (so the agent doesn't stop after a brief
    // summary).
    expect(result.content).toContain('[Output from "review" subagent');
    expect(result.content).toContain('hello from subagent');
    expect(result.content).toContain('[End of "review" subagent output');
    expect(result.content).toContain("continue working on the user's original task");
    expect(result.content).toContain('Take the next concrete step now');
    // `raw` is the unwrapped final assistant content from the subagent
    // run. The `@`-mention dispatch path uses it to build a single
    // hidden relay-context message — the wrapped `content` above is for
    // the LLM-driven tool path.
    expect(result.raw).toBe('hello from subagent');
    // `runId` is the registry id; lets callers correlate the subagent
    // run with persisted state and the live header.
    const list = runs.list();
    expect(list.length).toBe(1);
    expect(list[0].status).toBe('done');
    expect(result.runId).toBe(list[0].id);
    // Persisted transcript keeps the subagent's raw output (no prefix).
    expect(list[0].finalContent).toBe('hello from subagent');
  });

  it('reports an error when the registry exposes no providers', async () => {
    const view = makeRegistryView(() => undefined);
    const runs = createSubagentRunRegistry();
    const result = await runSubagent({
      agent: AGENT,
      task: 'do it',
      config: CONFIG,
      model: 'gpt',
      registry: view,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      runRegistry: runs,
    });
    expect(result.error).toBe(true);
    expect(result.content).toContain('No provider registered');
    expect(runs.list()[0].status).toBe('error');
  });

  it('emits a header message into the host message bus', async () => {
    const providers = fakeProviders();
    const view = makeRegistryView(() => providers);
    const runs = createSubagentRunRegistry();
    const appended: ChatMessage[] = [];
    const noop = (): void => {
      // intentional: bus stubs
    };
    const noopUnsub = (): (() => void) => noop;
    const bus = {
      append: (m: ChatMessage) => appended.push(m),
      injectNext: noop,
      drainNext: () => [],
      subscribe: noopUnsub,
      get: () => [],
    };
    await runSubagent({
      agent: AGENT,
      task: 'do it',
      config: CONFIG,
      model: 'gpt',
      registry: view,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      runRegistry: runs,
      messageBus: bus,
    });
    expect(appended.length).toBe(1);
    expect(appended[0].customType).toBe('mu-agents.subagent');
    expect(appended[0].meta?.subagentRunId).toBeString();
    // The header is UI-only: `display.llmHidden` strips it from the LLM
    // payload right before the network call, so the parent agent never
    // sees a phantom assistant message between the user mention and the
    // synthetic tool-call we inject for the @-mention dispatch flow.
    expect(appended[0].display?.llmHidden).toBe(true);
  });

  it('queues the header via injectNext when headerVia="injectNext"', async () => {
    // The @-mention dispatch path uses this mode so the header lands
    // AFTER the user's own message in the final transcript order. The
    // test pins both that nothing is appended live and that the queued
    // payload still carries `subagentRunId` + `display.llmHidden`.
    const providers = fakeProviders();
    const view = makeRegistryView(() => providers);
    const runs = createSubagentRunRegistry();
    const appended: ChatMessage[] = [];
    const queued: ChatMessage[] = [];
    const noop = (): void => {
      // intentional
    };
    const noopUnsub = (): (() => void) => noop;
    const bus = {
      append: (m: ChatMessage) => appended.push(m),
      injectNext: (m: ChatMessage) => queued.push(m),
      drainNext: () => [],
      subscribe: noopUnsub,
      get: () => [],
    };
    await runSubagent({
      agent: AGENT,
      task: 'do it',
      config: CONFIG,
      model: 'gpt',
      registry: view,
      approvalGateway: createApprovalGateway(),
      approvalChannelId: 'tui',
      runRegistry: runs,
      messageBus: bus,
      headerVia: 'injectNext',
    });
    expect(appended.length).toBe(0);
    expect(queued.length).toBe(1);
    expect(queued[0].customType).toBe('mu-agents.subagent');
    expect(queued[0].meta?.subagentRunId).toBeString();
    expect(queued[0].display?.llmHidden).toBe(true);
  });
});
