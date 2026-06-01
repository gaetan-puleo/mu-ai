import type { Tool } from 'mu-core';
import type { SkillRegistry } from './registry';

export const createSkillTool = (registry: SkillRegistry): Tool => ({
  name: 'skill',
  description: "Load a named skill's instructions into the conversation, then follow them.",
  get prompt() {
    const list = registry.list();
    if (!list.length) return undefined;
    const catalog = list.map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`).join(
      '\n',
    );
    return `When a request matches one of these skills, call \`skill\` with its name BEFORE acting, then follow the returned instructions:\n${catalog}`;
  },
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  run: async (input) => {
    const { name } = (input ?? {}) as { name?: string };
    if (!name) return [{ type: 'text', text: 'Error: skill requires `name`.' }];
    const skill = registry.get(name);
    if (!skill) return [{ type: 'text', text: `Error: unknown skill "${name}".` }];
    const header = skill.dir
      ? `Skill "${skill.name}" (bundled files live under ${skill.dir}):\n\n`
      : `Skill "${skill.name}":\n\n`;
    return [{ type: 'text', text: header + skill.prompt }];
  },
});
