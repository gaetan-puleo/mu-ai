import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, PluginRegistry, ProviderConfig, ToolDefinition } from 'mu-core';

/**
 * Render a plain-text view of the full LLM context — the merged system
 * prompt, registered tool definitions, and the message transcript — in the
 * order and shape mirrored from `mu-provider/src/stream.ts buildMessages`.
 *
 * This is a *logical* view: the exact token framing applied on the wire is
 * controlled by the server's per-model chat template (ChatML, Llama-3,
 * Hermes, etc.) and cannot be reproduced client-side. The dump captures
 * what the model semantically receives, which is what matters for
 * estimating token usage and pruning context.
 */
function mergedSystemPrompt(config: ProviderConfig, pluginPrompts: string[]): string {
  return pluginPrompts.length > 0
    ? [config.systemPrompt, ...pluginPrompts].filter(Boolean).join('\n\n')
    : (config.systemPrompt ?? '');
}

function renderTools(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '=== TOOLS (0) ===\n(no tools registered)\n';
  const blocks = tools.map((t, i) => {
    // Compact JSON mirrors what gets injected into the system prompt by
    // most chat templates — pretty-printing here would misrepresent the
    // actual on-the-wire token cost.
    const params = JSON.stringify(t.function.parameters);
    const desc = t.function.description ? ` ${t.function.description}` : '';
    return `[${i + 1}] ${t.function.name}${desc}\n    parameters: ${params}`;
  });
  return `=== TOOLS (${tools.length}) ===\n${blocks.join('\n')}\n`;
}

function renderUser(m: ChatMessage): string {
  const lines: string[] = [];
  const hasImages = (m.images?.length ?? 0) > 0;
  const text = m.content.trim() || (hasImages ? '(image attached)' : '');
  if (text) lines.push(text);
  if (m.images) {
    for (const img of m.images) {
      lines.push(`[image: ${img.mimeType}, ${img.name}]`);
    }
  }
  return lines.join('\n');
}

function renderAssistant(m: ChatMessage): string {
  const lines: string[] = [];
  if (m.content) {
    lines.push(m.content);
  } else if (m.toolCalls?.length) {
    lines.push('(no content)');
  }
  if (m.toolCalls) {
    for (const tc of m.toolCalls) {
      lines.push(`[tool_call id=${tc.id}] ${tc.function.name}(${tc.function.arguments})`);
    }
  }
  return lines.join('\n');
}

function renderMessage(m: ChatMessage, index: number): string {
  if (m.role === 'tool') {
    const header = `--- [${index}] tool (call_id=${m.toolCallId ?? ''}) ---`;
    return `${header}\n${m.content}`;
  }
  const header = `--- [${index}] ${m.role} ---`;
  let body: string;
  if (m.role === 'user') body = renderUser(m);
  else if (m.role === 'assistant') body = renderAssistant(m);
  else body = m.content; // system / fallback
  return `${header}\n${body}`;
}

function renderContext(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  pluginPrompts: string[],
): string {
  const system = mergedSystemPrompt(config, pluginPrompts);
  const header = `# Logical context view — exact token framing depends on the server-side chat template for model "${config.model ?? '(unset)'}".\n`;
  const systemBlock = `=== SYSTEM ===\n${system || '(empty)'}\n`;
  const toolsBlock = renderTools(tools);
  const messagesHeader = `=== MESSAGES (${messages.length}) ===`;
  const messagesBlock = messages.map((m, i) => renderMessage(m, i + 1)).join('\n\n');
  return [header, systemBlock, toolsBlock, messagesHeader, messagesBlock].join('\n');
}

/**
 * Build the plain-text context view and write it to a temp file. Returns
 * the absolute path so the caller can surface it (e.g. via toast).
 */
export async function dumpContext(
  config: ProviderConfig,
  messages: ChatMessage[],
  registry: PluginRegistry,
): Promise<string> {
  const pluginPrompts = await registry.getSystemPrompts();
  const tools = registry.getToolDefinitions();
  const text = renderContext(config, messages, tools, pluginPrompts);
  const path = join(tmpdir(), `mu-context-${Date.now()}.txt`);
  await writeFile(path, text, 'utf-8');
  return path;
}
