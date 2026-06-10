import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from 'mu-core';
import type { Scope } from '../common';
import { parseSkill } from './parser';
import type { SkillRegistry } from './registry';

const slug = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const createSkillWriterTool = (
  deps: { dirs: Record<Scope, string>; registry: SkillRegistry; forceScope?: Scope },
): Tool => {
  const { forceScope } = deps;
  const scopeProp = forceScope ? {} : {
    scope: {
      type: 'string',
      enum: ['local', 'config'],
      description:
        'Where to save it: "local" = this project (<cwd>/skills), "config" = global config dir. Defaults to "local".',
    },
  };
  return {
    name: 'create_skill',
    description: forceScope
      ? `Create a reusable skill (name, description, instructions) the agent can load on demand later — capture a reusable workflow worth keeping. Always saved to the global "${forceScope}" skills directory; load it later via \`skill\`.`
      : 'Create a reusable skill (name, description, instructions) the agent can load on demand later — capture a reusable workflow worth keeping. `scope: "local"` saves it to this project, `scope: "config"` makes it available across all projects; load it later via `skill`.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short skill name (kebab-case).' },
        description: { type: 'string', description: 'One line describing when this skill should be used.' },
        instructions: {
          type: 'string',
          description: 'The skill body: the instructions to follow when it is invoked.',
        },
        ...scopeProp,
      },
      required: ['name', 'description', 'instructions'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { name, description, instructions, scope } = (input ?? {}) as {
        name?: string;
        description?: string;
        instructions?: string;
        scope?: Scope;
      };
      if (!name || !description || !instructions) {
        return [{ type: 'text', text: 'Error: create_skill requires `name`, `description`, and `instructions`.' }];
      }
      // A configured forceScope wins over whatever the model passed.
      const resolved = forceScope ?? scope ?? 'local';
      const base = deps.dirs[resolved];
      if (!base) return [{ type: 'text', text: `Error: unknown scope "${scope}".` }];
      const id = slug(name);
      if (!id) return [{ type: 'text', text: `Error: invalid skill name "${name}".` }];
      const skillDir = join(base, id);
      const file = join(skillDir, 'SKILL.md');
      const source = `---\nname: ${id}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions.trim()}\n`;
      await mkdir(skillDir, { recursive: true });
      await writeFile(file, source, 'utf-8');
      deps.registry.add(parseSkill(source, id, skillDir));
      return [{ type: 'text', text: `Created skill "${id}" at ${file}. It is now available via the \`skill\` tool.` }];
    },
  };
};
