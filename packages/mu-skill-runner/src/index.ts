/**
 * mu-skill-runner — discover and execute SKILL.md skills.
 *
 * Surface:
 *   - `run_skill` tool — the LLM picks a skill and passes args. The rendered
 *     skill body is returned as the tool result, so the agent loop sends it
 *     back into the next LLM call automatically (no isolation).
 *
 * Isolation can be added later by switching to `api.createSession(...)` and
 * running a child turn instead of reusing the active session.
 */

import type { Plugin, PluginAPI, Tool } from 'mu-core';
import { renderSkillBody } from './parser';
import { type DiscoveredSkill, SkillRegistry, type SkillSourceConfig } from './runner';

export type { ParsedSkill, RenderOptions, SkillFrontmatter } from './parser';
export type { DiscoveredSkill, SkillSourceConfig } from './runner';

export interface SkillRunnerOptions extends SkillSourceConfig {
  /** Skip `!`cmd`` injection (useful in tests). Defaults to true. */
  enableShell?: boolean;
  /** Per-command shell timeout in ms. Default 10_000. */
  shellTimeoutMs?: number;
}

const SCOPE_HINT = 'Add SKILL.md files under ~/.config/mu/skills/, .mu/skills/, or .skills/.';

function describeSkill(s: DiscoveredSkill): string {
  const desc = s.description ? ` — ${s.description}` : '';
  return `- ${s.name}${desc} (${s.scope})`;
}

function renderHeader(skill: DiscoveredSkill, args: string): string {
  const argsLine = args.length > 0 ? `\nArguments: ${args}` : '';
  return `# Skill: ${skill.name}\n\nLoaded from ${skill.path}.${argsLine}\n\n---\n\n`;
}

function knownNames(registry: SkillRegistry): string {
  return (
    registry
      .list()
      .map((s) => s.name)
      .join(', ') || '(none)'
  );
}

interface RenderDeps {
  registry: SkillRegistry;
  getCwd: () => string;
  enableShell: boolean;
  shellTimeoutMs: number;
}

function renderSkill(deps: RenderDeps, skill: DiscoveredSkill, args: string): string {
  const body = renderSkillBody(skill.body, {
    args,
    cwd: deps.getCwd(),
    shell: deps.enableShell,
    shellTimeoutMs: deps.shellTimeoutMs,
  });
  return renderHeader(skill, args) + body;
}

// ─── Tool ────────────────────────────────────────────────────────────────────

function buildRunSkillTool(deps: RenderDeps): Tool {
  return {
    name: 'run_skill',
    description:
      'Load and execute a named skill in the current session. The skill body is returned as the tool result so the model follows its instructions on the next turn. Use `list_skills: true` to see what is available.',
    systemPrompt: () => {
      const all = deps.registry.list();
      if (all.length === 0) return undefined;
      return [
        'Available skills (invoke via the `run_skill` tool):',
        all.map(describeSkill).join('\n'),
        'Pass `args` as a single string; positional values are split shell-style.',
      ].join('\n');
    },
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (matches frontmatter `name` or directory name).',
        },
        args: {
          type: 'string',
          description: 'Optional argument string. Substituted into $ARGUMENTS / $N in the skill body.',
        },
        list_skills: {
          type: 'boolean',
          description: 'Return the list of available skills instead of running one.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    matchKey: (args) => (typeof args.name === 'string' ? args.name : undefined),
    formatArgs: (args) => {
      if (args.list_skills === true) {
        return [{ label: 'action', value: 'list_skills' }];
      }
      const name = typeof args.name === 'string' ? args.name : String(args.name ?? '');
      const skillArgs = typeof args.args === 'string' ? args.args : '';
      const lines = [{ label: 'skill', value: name }];
      if (skillArgs) {
        lines.push({ label: 'args', value: skillArgs.length > 120 ? `${skillArgs.slice(0, 120)}…` : skillArgs });
      }
      return lines;
    },
    async execute(args) {
      if (args.list_skills === true) {
        const all = deps.registry.list();
        if (all.length === 0) {
          return { content: `No skills discovered. ${SCOPE_HINT}` };
        }
        return { content: `Available skills:\n${all.map(describeSkill).join('\n')}` };
      }
      const name = typeof args.name === 'string' ? args.name : '';
      if (!name) {
        return { content: 'Error: `name` is required (or pass `list_skills: true`).', error: true };
      }
      const skill = deps.registry.get(name);
      if (!skill) {
        return {
          content: `Error: unknown skill "${name}". Known: ${knownNames(deps.registry)}`,
          error: true,
        };
      }
      const rawArgs = typeof args.args === 'string' ? args.args : '';
      try {
        return { content: renderSkill(deps, skill, rawArgs) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error rendering skill "${name}": ${msg}`, error: true };
      }
    },
  };
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

function registerSurfaces(api: PluginAPI, deps: RenderDeps): void {
  api.tool(buildRunSkillTool(deps));
}

export function createSkillRunnerPlugin(options: SkillRunnerOptions = {}): Plugin {
  const deps: RenderDeps = {
    registry: new SkillRegistry(options),
    getCwd: options.getCwd ?? ((): string => process.cwd()),
    enableShell: options.enableShell !== false,
    shellTimeoutMs: options.shellTimeoutMs ?? 10_000,
  };

  return {
    name: 'mu-skill-runner',
    register(api) {
      registerSurfaces(api, deps);
    },
    deactivate() {
      deps.registry.refresh();
    },
  };
}

export default createSkillRunnerPlugin;
