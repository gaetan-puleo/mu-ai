/**
 * Smoke-test the @<subagent> forced-dispatch path. We exercise the
 * plugin's `transformUserInput` hook end-to-end: build the plugin against
 * a fake provider + message bus, fire a user message starting with
 * `@review`, and verify (a) the message is intercepted, (b) the user's
 * text is appended to the transcript, (c) a SubagentRun is created, and
 * (d) the run completes against the fake provider.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChatMessage,
  createProviderRegistry,
  type LifecycleHooks,
  type PluginContext,
  type PluginRegistryView,
  type StreamChunk,
} from 'mu-core';
import type { AgentManager } from './manager';
import { createAgentsPlugin } from './plugin';
import type { SubagentRunRegistry } from './subagentRun';

interface AgentPluginShape {
  runs: SubagentRunRegistry;
  hooks: LifecycleHooks;
  manager: AgentManager;
}

function makeProviderView(): PluginRegistryView {
  const providers = createProviderRegistry();
  providers.register({
    id: 'openai',
    async *streamChat(): AsyncIterable<StreamChunk> {
      yield { type: 'content', text: 'review reply' };
    },
    async listModels() {
      return [];
    },
  });
  return {
    getTools: () => [],
    getFilteredTools: async () => [],
    getHooks: () => [],
    getSystemPrompts: async () => [],
    applySystemPromptTransforms: async (p) => p,
    getProviders: () => providers,
  };
}

const NOOP = (): void => undefined;

function makeBus() {
  const appended: ChatMessage[] = [];
  const injected: ChatMessage[] = [];
  return {
    appended,
    bus: {
      append: (m: ChatMessage) => appended.push(m),
      injectNext: (m: ChatMessage) => injected.push(m),
      drainNext: () => {
        const out = [...injected];
        injected.length = 0;
        return out;
      },
      subscribe: () => NOOP,
      get: () => [],
    },
  };
}

function settingsPathStub(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mu-agents-mention-'));
  return join(dir, 'state.json');
}

async function _waitForRunStatus(
  runs: SubagentRunRegistry,
  predicate: (status: string) => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = runs.list();
    if (list[0] && predicate(list[0].status)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: scenario test suite — each `it` exercises the full @-mention dispatch flow end-to-end with detailed assertions; splitting would duplicate the elaborate shared setup.
describe('@<subagent> forced dispatch', () => {
  it('runs the subagent and queues a synthetic tool flow for the parent turn', async () => {
    const settingsPath = settingsPathStub();
    try {
      const plugin = createAgentsPlugin({
        settingsPath,
        agentsDir: '/nonexistent',
        config: { providerId: 'openai' },
        model: 'gpt',
      }) as ReturnType<typeof createAgentsPlugin> & AgentPluginShape;

      const view = makeProviderView();
      const { bus, appended } = makeBus();
      const ctx = {
        cwd: '/',
        config: {},
        registry: view,
        messages: bus,
        getPlugin: () => undefined,
      } as unknown as PluginContext;

      plugin.activate?.(ctx);

      const transform = await plugin.hooks?.transformUserInput?.('@review please look at the diff');
      // `continue` tells the host: hook handled the user msg itself
      // (live-appended via `bus.append`), still drain the queue and
      // stream the LLM follow-up — but don't push another user msg.
      expect(transform?.kind).toBe('continue');

      // The subagent ran end-to-end before `transformUserInput` resolved.
      const run = plugin.runs.list()[0];
      expect(run?.agentName).toBe('review');
      expect(run?.status).toBe('done');
      expect(run?.finalContent).toBe('review reply');

      // Live (appended) messages, in order: user message, then the
      // subagent header (`runSubagent` defaults to `headerVia: 'append'`,
      // so the SubagentMessage shows live `running…` during the await).
      expect(appended.length).toBe(2);
      const [userMsg, subagentHeader] = appended;
      expect(userMsg.role).toBe('user');
      expect(userMsg.content).toBe('@review please look at the diff');
      expect(subagentHeader.customType).toBe('mu-agents.subagent');
      expect(subagentHeader.display?.llmHidden).toBe(true);
      expect(subagentHeader.meta?.subagentRunId).toBeString();

      // Queued: a single hidden `user` message carrying the subagent's
      // raw output + the relay/continue instruction. The host's
      // `session.runTurn` drains it right after the (now skipped)
      // user-message push, so the final transcript reads
      // `[..., user, header (llmHidden), relayPrompt (hidden)]`.
      // The previous design queued a synth (assistant, tool) pair which
      // both rendered a redundant `✓ subagent` UI block and duplicated
      // the body in the LLM payload. The new design keeps disk and wire
      // byte-aligned: the model sees the body once.
      const queued = bus.drainNext();
      expect(queued.length).toBe(1);
      const [relayPrompt] = queued;

      expect(relayPrompt.role).toBe('user');
      expect(relayPrompt.display?.hidden).toBe(true);
      expect(relayPrompt.meta?.source).toBe('mu-agents.mention-dispatch.relayContext');
      expect(relayPrompt.meta?.subagentRunId).toBe(run?.id);
      expect(relayPrompt.meta?.agent).toBe('review');
      // Carries the raw subagent output (not the wrapper) plus the
      // agent name + relay instruction so the parent has everything it
      // needs to produce its real follow-up.
      expect(relayPrompt.content).toContain('review reply');
      expect(relayPrompt.content).toContain('review');
      expect(relayPrompt.content).toContain('please look at the diff');
      expect(relayPrompt.content).not.toContain('[Output from');

      plugin.deactivate?.();
    } finally {
      rmSync(settingsPath, { force: true });
    }
  });

  it('passes through unchanged when the mention is not a known subagent', async () => {
    const settingsPath = settingsPathStub();
    try {
      const plugin = createAgentsPlugin({
        settingsPath,
        agentsDir: '/nonexistent',
        config: { providerId: 'openai' },
      }) as ReturnType<typeof createAgentsPlugin> & AgentPluginShape;
      const view = makeProviderView();
      const { bus } = makeBus();
      plugin.activate?.({
        cwd: '/',
        config: {},
        registry: view,
        messages: bus,
        getPlugin: () => undefined,
      } as unknown as PluginContext);
      const transform = await plugin.hooks?.transformUserInput?.('@unknown look here');
      expect(transform?.kind).toBe('pass');
      plugin.deactivate?.();
    } finally {
      rmSync(settingsPath, { force: true });
    }
  });

  it("falls through when the active agent doesn't have the subagent tool", async () => {
    // Plan is read-only (`tools: ['read', 'list_symbols']`) and must not be
    // able to dispatch subagents via @-mentions either — otherwise typing
    // `@review …` would bypass the agent's tool whitelist.
    const settingsPath = settingsPathStub();
    try {
      const plugin = createAgentsPlugin({
        settingsPath,
        agentsDir: '/nonexistent',
        config: { providerId: 'openai' },
        model: 'gpt',
      }) as ReturnType<typeof createAgentsPlugin> & AgentPluginShape;

      const view = makeProviderView();
      const { bus, appended } = makeBus();
      plugin.activate?.({
        cwd: '/',
        config: {},
        registry: view,
        messages: bus,
        getPlugin: () => undefined,
      } as unknown as PluginContext);

      // Switch to the read-only `plan` agent before sending the mention.
      const switched = plugin.manager.setActive('plan');
      expect(switched).toBe(true);

      const transform = await plugin.hooks?.transformUserInput?.('@review please look at the diff');
      // Not intercepted → the mention falls through as plain text. Plan
      // can't dispatch a subagent tool either (filtered out of the tool
      // list), so the message becomes a no-op user turn.
      expect(transform?.kind).toBe('pass');
      // The mention path must not have appended/dispatched anything.
      expect(appended.some((m) => m.role === 'user')).toBe(false);
      expect(plugin.runs.list().length).toBe(0);

      plugin.deactivate?.();
    } finally {
      rmSync(settingsPath, { force: true });
    }
  });
});
