import type { PluginRegistry } from 'mu-agents';
import type { ChatMessage, ProviderConfig } from 'mu-provider';
import { listModels, streamChat } from 'mu-provider';

export async function runSingleShot(prompt: string, config: ProviderConfig, registry: PluginRegistry): Promise<void> {
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  let resolvedModel = config.model;
  if (!resolvedModel) {
    const models = await listModels(config.baseUrl);
    if (models.length === 0) {
      console.error('Error: no models available at', config.baseUrl);
      process.exit(1);
    }
    resolvedModel = models[0].id;
  }

  const toolDefinitions = registry.getToolDefinitions();

  let tokens = 0;
  let hasToolCalls = false;
  process.stdout.write('mu: ');
  for await (const chunk of streamChat(messages, config, resolvedModel, {
    onUsage: (usage) => {
      tokens = usage.totalTokens;
    },
    tools: toolDefinitions,
  })) {
    if (chunk.type === 'content') {
      process.stdout.write(chunk.text);
    } else if (chunk.type === 'tool_call') {
      hasToolCalls = true;
    }
  }
  if (hasToolCalls) {
    process.stderr.write('\n[tool calls made — use interactive mode for tool execution]\n');
  }
  process.stdout.write('\n');
  if (tokens > 0) {
    process.stderr.write(`(${tokens} tokens)\n`);
  }
}
