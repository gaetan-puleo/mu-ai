import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from 'mu-core';
import { parseSkill } from './parser';
import type { SkillRegistry } from './registry';

const slug = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export type SkillScope = 'local' | 'config';

export const createSkillWriterTool = (
  deps: { dirs: Record<SkillScope, string>; registry: SkillRegistry },
): Tool => ({
  name: 'create_skill',
  description: 'Create a reusable skill: a named set of instructions the agent can load on demand later.',
  prompt:
    'When you discover a reusable workflow worth keeping, capture it with `create_skill` (name, description, instructions). Use `scope: "local"` for a skill specific to this project, or `scope: "config"` to make it available across all projects. It can then be loaded via `skill`.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short skill name (kebab-case).' },
      description: { type: 'string', description: 'One line describing when this skill should be used.' },
      instructions: { type: 'string', description: 'The skill body: the instructions to follow when it is invoked.' },
      scope: {
        type: 'string',
        enum: ['local', 'config'],
        description:
          'Where to save it: "local" = this project (<cwd>/skills), "config" = global config dir. Defaults to "local".',
      },
    },
    required: ['name', 'description', 'instructions'],
    additionalProperties: false,
  },
  run: async (input) => {
    const { name, description, instructions, scope } = (input ?? {}) as {
      name?: string;
      description?: string;
      instructions?: string;
      scope?: SkillScope;
    };
    if (!name || !description || !instructions) {
      return [{ type: 'text', text: 'Error: create_skill requires `name`, `description`, and `instructions`.' }];
    }
    const base = deps.dirs[scope ?? 'local'];
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
});
