import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentsPlugin } from 'mu-agents';
import { startMu } from 'mu-core';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createMuToolsPlugin } from 'mu-tools';

function fakeConfig() {
  return {
    baseUrl: 'http://localhost:0',
    model: 'test-model',
    maxTokens: 1024,
    temperature: 0.7,
    streamTimeoutMs: 10_000,
  };
}

describe('startMu — mu-coding boot', () => {
  it('registers builtins and exposes registries', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mu-cr-'));
    try {
      const runtime = await startMu({
        cwd,
        config: fakeConfig(),
        plugins: [
          createOpenAIProviderPlugin(),
          createAgentsPlugin({ config: fakeConfig(), model: 'test' }),
          createMuToolsPlugin(),
        ],
      });

      // Provider registered.
      expect(runtime.providers.list().some((p) => p.id === 'openai')).toBe(true);

      // All builtin plugins loaded.
      const names = runtime.registry.getPlugins().map((p) => p.name);
      expect(names).toContain('mu-openai-provider');
      expect(names).toContain('mu-agents');
      expect(names).toContain('mu-tools');

      // mu-agents exposes its approval gateway publicly.
      interface GatewayBearer {
        approvalGateway?: { registerChannel: unknown };
      }
      const agent = runtime.registry.getPlugin<GatewayBearer & { name: string; [k: string]: unknown }>('mu-agents');
      expect(agent?.approvalGateway).toBeDefined();

      // SessionManager works.
      const session = runtime.sessions.getOrCreate('test');
      expect(session.id).toBe('test');

      // submitText / submitCommand are callable.
      expect(typeof runtime.submitText).toBe('function');
      expect(typeof runtime.submitCommand).toBe('function');

      await runtime.shutdown();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('submitCommand dispatches to registered slash commands', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mu-cr-'));
    try {
      const runtime = await startMu({
        cwd,
        config: fakeConfig(),
        plugins: [
          {
            name: 'test-cmds',
            commands: [
              {
                name: 'hello',
                description: 'say hello',
                execute: async (args) => `hi ${args}`,
              },
            ],
          },
        ],
      });

      const result = await runtime.submitCommand({ sessionId: 's1', commandName: 'hello', args: 'world' });
      expect(result).toEqual({ kind: 'executed', output: 'hi world' });

      const missing = await runtime.submitCommand({ sessionId: 's1', commandName: 'nope', args: '' });
      expect(missing).toEqual({ kind: 'not_found' });

      await runtime.shutdown();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
