import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, Provider, StreamEvent, Tool } from 'mu-core';
import { type AgentSessionEvent, createHarness, type XdgDirs } from 'mu-harness';
import { createMuTools } from 'mu-ai-tools';

const tempXdg = (): { xdg: XdgDirs; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'mu-smoke-'));
  return { dir, xdg: { configHome: join(dir, 'config'), dataHome: join(dir, 'data'), stateHome: join(dir, 'state') } };
};

const stubProvider = (parts: StreamEvent[]): Provider => ({
  async *stream() {
    for (const part of parts) yield part;
  },
});

describe('coding-agent harness wiring', () => {
  it('runs a streamed turn via a created session', async () => {
    const { dir, xdg } = tempXdg();
    const harness = await createHarness({
      hostName: 'mu-test',
      xdg,
      providers: { local: stubProvider([{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }]) },
      model: 'local/test-model',
      tools: createMuTools(),
      system: 'You are a test.',
      title: false,
    });

    try {
      const session = harness.sessions.create();
      const events: AgentSessionEvent[] = [];
      session.subscribe((event) => events.push(event));

      await session.send('hi');

      const types = events.map((e) => e.type);
      expect(types[0]).toBe('turn_start');
      expect(types).toContain('text');
      expect(types[types.length - 1]).toBe('turn_end');

      const assistant = session.messages.find((m) => m.role === 'assistant');
      const assistantText = assistant?.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
      expect(assistantText).toBe('Hello world');
    } finally {
      harness.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes the provider usage events via the session', async () => {
    const { dir, xdg } = tempXdg();
    const harness = await createHarness({
      hostName: 'mu-test',
      xdg,
      providers: {
        local: stubProvider([
          { type: 'text', text: 'ok' },
          { type: 'usage', usage: { input: 1200, output: 50, total: 1250, contextWindow: 32768 } },
        ]),
      },
      model: 'local/test-model',
      tools: createMuTools(),
      system: 'You are a test.',
      title: false,
    });

    try {
      const session = harness.sessions.create();
      const usageEvents: { input?: number; total?: number; contextWindow?: number }[] = [];
      session.subscribe((event) => {
        if (event.type === 'usage') usageEvents.push(event.usage);
      });

      await session.send('hi');

      expect(usageEvents.length).toBe(1);
      expect(usageEvents[0].total).toBe(1250);
      expect(usageEvents[0].contextWindow).toBe(32768);
      const assistant = session.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toEqual([{ type: 'text', text: 'ok' }]);
    } finally {
      harness.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds the per-tool prompts to the system message sent to the model', async () => {
    const { dir, xdg } = tempXdg();
    let captured: Message[] = [];
    const provider: Provider = {
      async *stream(req) {
        captured = req.messages;
        yield { type: 'text', text: 'ok' };
      },
    };
    const tool: Tool = {
      name: 'demo',
      description: 'demo tool',
      prompt: 'DEMO_TOOL_PROMPT',
      parameters: { type: 'object' },
      run: () => Promise.resolve([{ type: 'text', text: 'x' }]),
    };
    const harness = await createHarness({
      hostName: 'mu-test',
      xdg,
      providers: { local: provider },
      model: 'local/test-model',
      tools: [tool],
      system: 'BASE_SYS',
      title: false,
    });

    try {
      await harness.sessions.create().send('hi');
      const system = captured.find((m) => m.role === 'system');
      const text = system?.content.map((p) => (p.type === 'text' ? p.text : '')).join('') ?? '';
      expect(text).toContain('BASE_SYS');
      expect(text).toContain('DEMO_TOOL_PROMPT');
    } finally {
      harness.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('switches model and forks a session preserving the prior history', async () => {
    const { dir, xdg } = tempXdg();
    const harness = await createHarness({
      hostName: 'mu-test',
      xdg,
      providers: { local: stubProvider([{ type: 'text', text: 'ok' }]) },
      model: 'local/model-a',
      tools: createMuTools(),
      system: 'You are a test.',
      title: false,
    });

    try {
      const session = harness.sessions.create();
      await session.send('first');
      expect(harness.models.selected).toBe('local/model-a');

      harness.models.select('local/model-b');
      const forked = await harness.sessions.fork(session.id, session.messages.length - 1);
      expect(forked.id).not.toBe(session.id);
      const userTexts = forked.messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content.map((p) => (p.type === 'text' ? p.text : '')).join(''));
      expect(userTexts).toContain('first');
    } finally {
      harness.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
