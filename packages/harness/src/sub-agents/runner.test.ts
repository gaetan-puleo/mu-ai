import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import type { LLMProvider, Plugin, Tool, ToolCall, Tools } from 'mu-core';
import { runSubAgent } from './runner';
import type { SubAgent } from './types';

function providerPlugin(provider: LLMProvider): Plugin {
  return { name: 'test-provider', provider };
}

function makeSubAgent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    name: 'tester',
    description: 'A test sub-agent',
    prompt: 'You are a test agent.',
    tools: ['*'],
    permissions: [],
    filePath: '/agents/tester.md',
    ...overrides,
  };
}

describe('runSubAgent', () => {
  it('returns the assistant content from a single-turn response', async () => {
    const provider: LLMProvider = async () => ({ content: 'sub-agent says hi' });
    const result = await runSubAgent({
      subAgent: makeSubAgent(),
      prompt: 'do the thing',
      plugins: [providerPlugin(provider)],
    });
    expect(result).toEqual({ agentName: 'tester', content: 'sub-agent says hi' });
  });

  it('passes the sub-agent prompt body as the system message', async () => {
    let seenSystem = '';
    const provider: LLMProvider = async (messages) => {
      const system = messages.find((m) => m.role === 'system');
      seenSystem = system?.content ?? '';
      return { content: 'ok' };
    };
    await runSubAgent({
      subAgent: makeSubAgent({ prompt: 'You explore the codebase.' }),
      prompt: 'find foo',
      plugins: [providerPlugin(provider)],
    });
    expect(seenSystem).toContain('You explore the codebase.');
  });

  it('prepends systemPromptPrefix before the sub-agent body', async () => {
    let seenSystem = '';
    const provider: LLMProvider = async (messages) => {
      seenSystem = messages.find((m) => m.role === 'system')?.content ?? '';
      return { content: 'ok' };
    };
    await runSubAgent({
      subAgent: makeSubAgent({ prompt: 'agent body.' }),
      prompt: 'task',
      plugins: [providerPlugin(provider)],
      systemPromptPrefix: 'shared context.',
    });
    expect(seenSystem.indexOf('shared context.')).toBeLessThan(seenSystem.indexOf('agent body.'));
  });

  it('filters tools by allow list (only allowed tools reach the provider)', async () => {
    let seenToolNames: string[] = [];
    const provider: LLMProvider = async (_messages, tools) => {
      seenToolNames = Object.keys(tools);
      return { content: 'ok' };
    };
    const makeTool = (name: string): Tool => ({
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
      execute: () => 'unused',
      onError: (e) => String(e),
    });
    const allTools: Tools = {
      read_file: makeTool('read_file'),
      bash: makeTool('bash'),
      write_file: makeTool('write_file'),
    };
    await runSubAgent({
      subAgent: makeSubAgent({ tools: ['read_file', 'write_file'] }),
      prompt: 'task',
      tools: allTools,
      plugins: [providerPlugin(provider)],
    });
    expect(seenToolNames.sort()).toEqual(['read_file', 'write_file']);
  });

  it('exposes all tools when tools is ["*"]', async () => {
    let seenToolNames: string[] = [];
    const provider: LLMProvider = async (_messages, tools) => {
      seenToolNames = Object.keys(tools);
      return { content: 'ok' };
    };
    const makeTool = (name: string): Tool => ({
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
      execute: () => 'unused',
      onError: (e) => String(e),
    });
    const allTools: Tools = { a: makeTool('a'), b: makeTool('b') };
    await runSubAgent({
      subAgent: makeSubAgent({ tools: ['*'] }),
      prompt: 'task',
      tools: allTools,
      plugins: [providerPlugin(provider)],
    });
    expect(seenToolNames.sort()).toEqual(['a', 'b']);
  });

  it('reports errors from the runtime in the result', async () => {
    const provider: LLMProvider = async () => {
      throw new Error('boom');
    };
    const result = await runSubAgent({
      subAgent: makeSubAgent(),
      prompt: 'task',
      plugins: [providerPlugin(provider)],
    });
    expect(result.error).toBe('boom');
  });

  it('tags approval prompts with the sub-agent name', async () => {
    let seenMeta: { agent?: string } | undefined;
    const toolCall: ToolCall = { id: 'c1', name: 'echo', args: '{}' };
    let turn = 0;
    const provider: LLMProvider = async () => {
      turn++;
      if (turn === 1) return { tool_calls: [toolCall] };
      return { content: 'done' };
    };
    const echo: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      execute: () => 'ok',
      onError: (e) => String(e),
    };
    await runSubAgent({
      subAgent: makeSubAgent({
        name: 'explorer',
        tools: ['echo'],
        permissions: [{ tool: 'echo', decision: 'ask' }],
      }),
      prompt: 'go',
      tools: { echo },
      plugins: [providerPlugin(provider)],
      approvalPrompt: (_call, _matched, meta) => {
        seenMeta = meta;
        return Promise.resolve('allow');
      },
    });
    expect(seenMeta?.agent).toBe('explorer');
  });

  it('handles a tool-using turn followed by a final response', async () => {
    let turn = 0;
    const toolCall: ToolCall = { id: 'c1', name: 'echo', args: '{"msg":"hi"}' };
    const provider: LLMProvider = async () => {
      turn++;
      if (turn === 1) return { tool_calls: [toolCall] };
      return { content: 'all done' };
    };
    const echo: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: { msg: { type: 'string' } } },
      execute: (args) => {
        const obj = args as { msg: string };
        return obj.msg;
      },
      onError: (e) => String(e),
    };
    const result = await runSubAgent({
      subAgent: makeSubAgent({ tools: ['echo'] }),
      prompt: 'go',
      tools: { echo },
      plugins: [providerPlugin(provider)],
    });
    expect(result.content).toBe('all done');
    expect(turn).toBe(2);
  });

  it('aborts when the caller signal fires and surfaces the abort reason', async () => {
    // Provider that never resolves — without the signal the run would hang
    // forever on `waitForIdle`.
    const provider: LLMProvider = () => new Promise(() => {});
    const controller = new AbortController();
    queueMicrotask(() => controller.abort(new Error('caller cancelled')));
    const result = await runSubAgent({
      subAgent: makeSubAgent(),
      prompt: 'task',
      plugins: [providerPlugin(provider)],
      signal: controller.signal,
      pollIntervalMs: 1,
    });
    expect(result.error).toBe('caller cancelled');
  });

  it('times out cleanly when waitForIdle exceeds timeoutMs', async () => {
    const provider: LLMProvider = () => new Promise(() => {});
    const result = await runSubAgent({
      subAgent: makeSubAgent(),
      prompt: 'task',
      plugins: [providerPlugin(provider)],
      timeoutMs: 25,
      pollIntervalMs: 1,
    });
    expect(result.error).toContain('timed out');
  });
});
