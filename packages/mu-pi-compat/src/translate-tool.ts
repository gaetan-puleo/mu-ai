import type { PluginTool } from 'mu-agents';
import type { PiExtensionContext, PiToolDefinition } from './types';

/**
 * Translate a Pi tool definition into a mu PluginTool.
 *
 * Key differences:
 * - Pi uses TypeBox schemas (which produce JSON Schema) — no conversion needed
 * - Pi execute() returns { content: [{type:"text", text:"..."}], details: {} }
 * - Mu execute() returns a string
 * - Pi execute() receives (toolCallId, params, signal, onUpdate, ctx)
 * - Mu execute() receives (args, signal)
 */
export function translateTool(piDef: PiToolDefinition, ctx: PiExtensionContext): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: piDef.name,
        description: piDef.description,
        // TypeBox TSchema objects serialize to JSON Schema directly.
        // Plain JSON Schema objects pass through unchanged.
        parameters: normalizeSchema(piDef.parameters),
      },
    },
    async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
      const toolCallId = generateId();
      let _lastUpdate = '';

      const onUpdate = (partial: string) => {
        _lastUpdate = partial;
      };

      try {
        const result = await piDef.execute(toolCallId, args, signal, onUpdate, ctx);
        return extractTextContent(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return `Error: ${msg}`;
      }
    },
  };
}

/**
 * Normalize a TypeBox TSchema or plain JSON Schema object into a valid parameters record.
 */
function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema) {
    return { type: 'object', properties: {} };
  }
  // TypeBox schemas have a 'type' and 'properties' field — they ARE JSON Schema
  if (typeof schema === 'object' && schema !== null && 'type' in schema) {
    return schema as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
}

/**
 * Extract text content from a Pi tool result.
 * Pi returns: { content: [{type:"text", text:"..."}, ...], details: {} }
 * Mu expects: a single string.
 */
function extractTextContent(result: unknown): string {
  if (!result || typeof result !== 'object') return '';

  const r = result as { content?: unknown[]; details?: unknown };

  if (!(r.content && Array.isArray(r.content))) return '';

  const parts: string[] = [];
  for (const part of r.content) {
    if (typeof part === 'object' && part !== null && 'text' in part) {
      const text = (part as { text?: string }).text;
      if (text) parts.push(text);
    }
  }

  return parts.join('\n') || '';
}

/**
 * Generate a unique ID for tool calls.
 */
function generateId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
