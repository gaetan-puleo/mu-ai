/**
 * Focused tests for `runAgent`. Most coverage lives in higher layers
 * (session, mu-agents subagent, integration) but we keep a few pinpoint
 * cases here to lock down behaviour that's easy to break:
 *
 *  - `display.llmHidden` strips messages from the network payload but
 *    keeps them in the streamed transcript surface (regression target
 *    for the `@`-mention dispatch flow that injects a UI-only subagent
 *    header alongside a real synthetic tool flow).
 */
import { describe, expect, it } from 'bun:test';
import { runAgent } from './agent';
import { createProviderRegistry } from './provider/registry';
import { PluginRegistry } from './registry';
import type { ChatMessage, ProviderConfig, StreamChunk } from './types/llm';

interface CapturedCall {
  messages: ChatMessage[];
}

function fakeRegistry(captured: CapturedCall[]): PluginRegistry {
  const providers = createProviderRegistry();
  providers.register({
    id: 'openai',
    async *streamChat(messages: ChatMessage[]): AsyncIterable<StreamChunk> {
      // Snapshot the exact message list the provider receives so the test
      // can assert on what `streamTurn` actually sent over the wire.
      captured.push({ messages: messages.map((m) => ({ ...m })) });
      yield { type: 'content', text: 'ok' };
    },
    async listModels() {
      return [];
    },
  });
  return new PluginRegistry({ cwd: '/tmp', config: {}, providers });
}

const CFG: ProviderConfig = { providerId: 'openai' };

describe('runAgent — display.llmHidden filter', () => {
  it('strips llmHidden messages from the provider payload', async () => {
    const captured: CapturedCall[] = [];
    const registry = fakeRegistry(captured);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      // UI-only marker — must be filtered before the network call.
      {
        role: 'assistant',
        content: 'phantom header',
        display: { llmHidden: true },
      },
      { role: 'user', content: 'hi' },
    ];

    for await (const _ of runAgent(messages, CFG, 'm', new AbortController().signal, registry)) {
      // drain
    }

    expect(captured.length).toBe(1);
    const sent = captured[0].messages;
    // Only system + user reach the provider.
    expect(sent.length).toBe(2);
    expect(sent[0].role).toBe('system');
    expect(sent[1].role).toBe('user');
    expect(sent.find((m) => m.content === 'phantom header')).toBeUndefined();
  });

  it('keeps non-llmHidden messages even when `display.hidden` is set', async () => {
    // Inverse flag: `display.hidden` is UI-only suppression and must NOT
    // affect the LLM payload. This test pins that the two flags do not
    // accidentally collapse into the same filter.
    const captured: CapturedCall[] = [];
    const registry = fakeRegistry(captured);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'silent reminder', display: { hidden: true } },
      { role: 'user', content: 'hi' },
    ];

    for await (const _ of runAgent(messages, CFG, 'm', new AbortController().signal, registry)) {
      // drain
    }

    expect(captured.length).toBe(1);
    const sent = captured[0].messages;
    expect(sent.length).toBe(3);
    expect(sent.find((m) => m.content === 'silent reminder')).toBeDefined();
  });
});
