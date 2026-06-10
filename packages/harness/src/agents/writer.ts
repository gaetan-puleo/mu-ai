import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from '@std/yaml';
import type { ContentPart, Tool } from 'mu-core';
import type { Scope } from '../common';
import { parseAgent } from './parser';
import type { AgentRegistry } from './registry';
import type { ToolGrants } from './types';

const slug = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

interface AgentWriterArgs {
  name?: string;
  description?: string;
  prompt?: string;
  tools?: ToolGrants;
  model?: string;
  color?: string;
  scope?: Scope;
}

/**
 * `create_agent` — authors a reusable agent definition (`.md` with frontmatter)
 * and registers it live via {@link AgentRegistry.add}, so it can be delegated to
 * through `subagent` without a restart. Mirrors {@link createSkillWriterTool}:
 * the `scope` selects the save location, or a configured `forceScope` pins it.
 */
export const createAgentWriterTool = (
  deps: { dirs: Record<Scope, string>; registry: AgentRegistry; forceScope?: Scope },
): Tool => {
  const { forceScope } = deps;
  const scopeProp = forceScope ? {} : {
    scope: {
      type: 'string',
      enum: ['local', 'config'],
      description:
        'Where to save it: "local" = this project (repo-first), "config" = global config dir. Defaults to "local".',
    },
  };
  return {
    name: 'create_agent',
    description: forceScope
      ? `Define a reusable agent (name, description, system prompt, optional per-tool grants) that can be delegated to via \`subagent\`. Always saved to the "${forceScope}" agents directory.`
      : 'Define a reusable agent (name, description, system prompt, optional per-tool grants) that can be delegated to via `subagent`. `scope: "local"` saves it to this project, `scope: "config"` makes it available across all projects.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short agent name (kebab-case); also the filename.' },
        description: { type: 'string', description: 'One line describing what this agent is for.' },
        prompt: { type: 'string', description: 'The system prompt that defines the agent.' },
        tools: {
          type: 'object',
          description:
            'Optional per-tool grants: map a tool name to "allow" | "ask" | "deny" (or a nested {glob: decision} map). Omitted tools are denied — be explicit about what it may use.',
          additionalProperties: true,
        },
        model: { type: 'string', description: 'Optional model ref override.' },
        color: { type: 'string', description: 'Optional hex color for the UI.' },
        ...scopeProp,
      },
      required: ['name', 'description', 'prompt'],
      additionalProperties: false,
    },
    run: async (input): Promise<ContentPart[]> => {
      const { name, description, prompt, tools, model, color, scope } = (input ?? {}) as AgentWriterArgs;
      if (!name || !description || !prompt) {
        return [{ type: 'text', text: 'Error: create_agent requires `name`, `description`, and `prompt`.' }];
      }
      // A configured forceScope wins over whatever the model passed.
      const resolved = forceScope ?? scope ?? 'local';
      const base = deps.dirs[resolved];
      if (!base) return [{ type: 'text', text: `Error: unknown scope "${scope}".` }];
      const id = slug(name);
      if (!id) return [{ type: 'text', text: `Error: invalid agent name "${name}".` }];
      if (deps.registry.get(id)) {
        return [{ type: 'text', text: `Error: an agent named "${id}" already exists.` }];
      }
      const file = join(base, `${id}.md`);
      if (existsSync(file)) return [{ type: 'text', text: `Error: ${file} already exists.` }];

      const frontmatter: Record<string, unknown> = { name: id, description };
      if (model) frontmatter.model = model;
      if (color) frontmatter.color = color;
      if (tools && typeof tools === 'object') frontmatter.tools = tools;
      const source = `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${prompt.trim()}\n`;

      await mkdir(base, { recursive: true });
      await writeFile(file, source, 'utf-8');
      deps.registry.add(parseAgent(source, id));
      return [{
        type: 'text',
        text: `Created agent "${id}" at ${file}. It can now be delegated to via the \`subagent\` tool.`,
      }];
    },
  };
};
