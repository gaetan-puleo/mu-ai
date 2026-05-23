import { defineProvider } from './provider';
import type { LLMProvider, LLMResponse, Message, Tools } from './provider';

describe('defineProvider', () => {
  it('should return the factory unchanged', () => {
    const factory = defineProvider<{ model: string }>((config): LLMProvider => {
      return async () => ({ content: config.model });
    });

    expect(typeof factory).toBe('function');
  });

  it('should create an LLMProvider with typed config', async () => {
    const factory = defineProvider<{ model: string; response: string }>((config): LLMProvider => {
      return async () => ({ content: config.response });
    });

    const provider = factory({ model: 'test-model', response: 'hello' });

    const result = await provider([], {});

    expect(result.content).toBe('hello');
  });

  it('should receive messages and tools', async () => {
    let receivedMessages: Message[] = [];
    let receivedTools: Tools = {};

    const factory = defineProvider<{ model: string }>((config): LLMProvider => {
      return async (messages, tools) => {
        receivedMessages = messages;
        receivedTools = tools;
        return { content: 'ok' };
      };
    });

    const provider = factory({ model: 'test' });
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const tools: Tools = {
      test: {
        name: 'test',
        description: 'test tool',
        parameters: {},
        execute: () => 'result',
        onError: () => 'error',
      },
    };

    await provider(messages, tools);

    expect(receivedMessages).toEqual(messages);
    expect(receivedTools).toEqual(tools);
  });
});
