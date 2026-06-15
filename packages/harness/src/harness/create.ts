import os from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import type { Tool } from 'mu-core';
import type { Agent } from '../agents';
import { createAgentRegistry, grantArg, loadAgents, toolDecision, toolNames } from '../agents';
import {
  createAgentsCommand,
  createCommandRegistry,
  createCompactCommand,
  createContextCommand,
  createHelpCommand,
  createSessionsCommand,
  createSkillCommand,
  createSkillsCommand,
} from '../commands';
import { createHarnessConfig } from '../config';
import { type AgentSessionHooks, mergeHooks } from '../hooks';
import { allowList } from '../permissions';
import { createPluginStore } from '../plugin';
import { createScheduler, createScheduleTaskTool, createTasksCommand, createTaskStore } from '../scheduler';
import {
  type AgentSession,
  createAgentSession,
  createSessionCatalog,
  createSessionManager,
  createSessionStore,
  persistTo,
  runTitler,
} from '../session';
import { createRunSkillTool, createSkillRegistry, createSkillTool, loadSkills, runSkill } from '../skills';
import { createSubAgentRegistry, createSubAgentTool, runSubAgent } from '../subAgents';
import { environmentBlock } from './environment';
import { dirsForPath, loadInstructions } from './instructions';
import { createMemoryStore, createRememberTool } from './memory';
import { createCompactionHook } from './compaction';
import { createModelRegistry } from './models';
import { createVoice } from './voice';
import type { Harness, HarnessOptions } from './types';

const TITLE_AGENT: Agent = {
  name: 'title',
  description: 'Generates a concise session title from the first user message.',
  prompt:
    'Generate a concise title (3 to 6 words) for the conversation based on the user message. Reply with ONLY the title — no quotes, no trailing punctuation, no explanation.',
  tools: [],
};

/** Tool-input field names that carry filesystem paths — used to scope nested AGENTS.md. */
const PATH_KEYS = new Set([
  'path',
  'file',
  'filename',
  'file_path',
  'filepath',
  'dir',
  'directory',
  'cwd',
  'paths',
  'files',
]);
function pathsFromInput(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PATH_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) { for (const el of value) if (typeof el === 'string') out.push(el); }
  }
  return out;
}

export const createHarness = async (options: HarnessOptions): Promise<Harness> => {
  const {
    hostName,
    xdg,
    providers,
    model,
    agents: hostAgents = [],
    defaultAgents = [],
    skills: hostSkills = [],
    agentDirs,
    title,
    titleModel,
    scheduler: enableScheduler = false,
    approvals,
    ...sessionDefaults
  } = options;
  const cwd = options.cwd ?? process.cwd();
  const config = createHarnessConfig({ hostName, xdg });
  const models = createModelRegistry({ providers, default: model });
  const voice = createVoice(models, options.voice);
  const pluginsDir = join(config.configDir, 'plugins');
  const agentsDir = agentDirs?.config ?? join(config.configDir, 'agents');
  const localAgentsDir = agentDirs?.local ?? join(cwd, 'agents');
  const plugins = createPluginStore({ dir: pluginsDir });
  const newId = () => crypto.randomUUID();

  const pluginAgents = (sessionDefaults.plugins ?? []).flatMap((plugin) => plugin.agents ?? []);
  const loadDiskAgents = async (): Promise<
    Agent[]
  > => [...await loadAgents(localAgentsDir), ...await loadAgents(agentsDir)];
  // Priority (first wins): host > plugin > local dir > config dir > default fallback.
  const mergedAgents = async (): Promise<Agent[]> => [
    ...hostAgents,
    ...pluginAgents,
    ...await loadDiskAgents(),
    ...defaultAgents,
  ];
  const agents = createAgentRegistry(await mergedAgents());

  const skillsDir = join(config.configDir, 'skills');
  const cwdSkillsDir = join(cwd, 'skills');

  const envBlock = environmentBlock({
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    configDir: config.configDir,
    pluginsDir,
    skillsDir,
    agentsDir,
    hostName,
    hostSourceUrl: options.sourceUrl,
  });
  const envHook: AgentSessionHooks = {
    prepareRequest: ({ system }) => ({ system: system ? `${system}\n\n${envBlock}` : envBlock }),
  };

  // Project/global instructions (AGENTS.md / CLAUDE.md). Scopes: GLOBAL (configDir) + LOCAL
  // (cwd & ancestors) + on-demand NESTED (subdirs the agent touches). `accessedDirs` grows as
  // tools reference paths; the hook re-loads each turn so nested AGENTS.md appear when relevant.
  const accessedDirs = new Set<string>();
  const trackPathsHook: AgentSessionHooks = {
    beforeToolCall: ({ input }) => {
      for (const p of pathsFromInput(input)) for (const d of dirsForPath(cwd, p)) accessedDirs.add(d);
    },
  };
  const instructionsHook: AgentSessionHooks = {
    prepareRequest: async ({ system }) => {
      const block = await loadInstructions(cwd, config.configDir, { accessed: accessedDirs });
      if (!block) return undefined;
      const tagged = `<instructions>\n${block}\n</instructions>`;
      return { system: system ? `${system}\n\n${tagged}` : tagged };
    },
  };

  // Memory: GLOBAL (dataDir/MEMORY.md) + LOCAL (cwd/.mu/MEMORY.md), written via the `remember`
  // tool. Re-loaded each turn so a memory saved this session shows up on the next.
  const memory = createMemoryStore({ cwd, dataDir: config.dataDir });
  const memoryHook: AgentSessionHooks = {
    prepareRequest: async ({ system }) => {
      const block = await memory.load();
      if (!block) return undefined;
      const tagged = `<memory>\n${block}\n</memory>`;
      return { system: system ? `${system}\n\n${tagged}` : tagged };
    },
  };

  // Auto-compaction: summarize old messages as the context fills (enabled unless turned off).
  const compactionHook: AgentSessionHooks = options.compaction === false
    ? {}
    : createCompactionHook(options.compaction || {});

  const pluginSkills = (sessionDefaults.plugins ?? []).flatMap((plugin) => plugin.skills ?? []);
  const mergedSkills = async () => [
    ...hostSkills,
    ...pluginSkills,
    ...await loadSkills(cwdSkillsDir),
    ...await loadSkills(skillsDir),
  ];
  const skills = createSkillRegistry(await mergedSkills());
  const scopeSkills = (agent?: Agent) => {
    if (!agent) return skills;
    return skills.select(
      skills.list().map((s) => s.name).filter((name) => toolDecision(agent, 'skill', name) !== 'deny'),
    );
  };

  const tasks = enableScheduler ? createTaskStore({ dir: join(config.configDir, 'tasks') }) : undefined;
  let schedulerTools: Tool[] = [];

  const runs = createSubAgentRegistry();
  const store = createSessionStore({ dir: join(config.dataDir, 'sessions') });

  const sessionTools = (
    agent?: Agent,
    extra: Tool[] = [],
  ): Tool[] => [
    ...(sessionDefaults.tools ?? []),
    ...extra,
    createSkillTool(scopeSkills(agent)),
    createRememberTool(memory),
    ...schedulerTools,
  ];

  const approvalHook = (getAgent: () => Agent | undefined): AgentSessionHooks | undefined =>
    approvals
      ? approvals.manager.hooksFor({
        decide: (call) => {
          const agent = getAgent();
          if (!agent) return 'allow';
          if (approvals.decide) return approvals.decide(agent, call);
          return toolDecision(agent, call.name, grantArg(call.name, call.input));
        },
        agent: () => getAgent()?.name,
      })
      : undefined;

  const persona = (agent: Agent, opts: { tools?: Tool[]; hooks?: AgentSessionHooks; model?: string }): AgentSession =>
    createAgentSession({
      tools: opts.tools,
      plugins: sessionDefaults.plugins,
      system: agent.prompt,
      hooks: opts.hooks ?? allowList(toolNames(agent)),
      ...models.resolve(opts.model ?? agent.model),
      id: newId(),
    });

  const spawn = (agent: Agent): AgentSession =>
    persistTo(
      store,
      persona(agent, {
        tools: sessionTools(agent),
        hooks: mergeHooks([
          sessionDefaults.hooks,
          allowList(toolNames(agent)),
          approvalHook(() => agent),
          envHook,
          instructionsHook,
          memoryHook,
          trackPathsHook,
          compactionHook,
        ]),
      }),
    );

  const scheduler = enableScheduler && tasks
    ? createScheduler({
      store: tasks,
      run: async (task) => {
        try {
          if (!task.agent) throw new Error('scheduled task is missing an agent');
          if (!task.skill) throw new Error('scheduled task is missing a skill');
          const output = await runSkill({ skills, agents, spawn, runs, parentId: task.id }, {
            skill: task.skill,
            task: task.prompt,
            agent: task.agent,
          });
          return { ok: true, output };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    })
    : undefined;
  if (tasks && scheduler) {
    schedulerTools = [
      createRunSkillTool({ skills, agents, spawn, runs }),
      createScheduleTaskTool({ store: tasks, skills, onChange: () => scheduler.reload() }),
    ];
  }

  const titleSpawn = (agent: Agent): AgentSession => persona(agent, { model: titleModel });

  const catalog = createSessionCatalog({ file: join(config.dataDir, 'sessions.db') });
  runs.subscribe((run) => catalog.record(run.runId, { cwd, parentId: run.parentId }));
  const sessions = createSessionManager({
    store,
    catalog,
    newId,
    cwd,
    title: title === false ? undefined : ({ id, text }) => {
      // Internal/hidden sessions (id prefixed with `__`, e.g. a voice STT scratch
      // session) are machinery, not conversations: don't spend a title-model turn
      // on them — it both wastes a call and interleaves the main model into an
      // otherwise single-model flow.
      if (id.startsWith('__')) return;
      void runTitler({
        id,
        text,
        setTitle: (sid, value) => catalog.setTitle(sid, value),
        generate: (input) => runSubAgent(TITLE_AGENT, input, { spawn: titleSpawn }).then((result) => result.text),
      });
    },
    revive: ({ id, model: ref, messages }) =>
      createAgentSession({
        ...sessionDefaults,
        hooks: mergeHooks([
          sessionDefaults.hooks,
          approvalHook(() => approvals?.activeAgent()),
          envHook,
          instructionsHook,
          memoryHook,
          trackPathsHook,
          compactionHook,
        ]),
        tools: sessionTools(undefined, [createSubAgentTool({ registry: agents, spawn, runs, parentId: id })]),
        ...models.resolve(ref),
        id,
        messages,
      }),
  });

  const commands = createCommandRegistry([
    createAgentsCommand(agents),
    createSkillsCommand(skills),
    createSessionsCommand(sessions, { cwd }),
    createContextCommand(),
    createCompactCommand(),
    ...(tasks ? [createTasksCommand(tasks)] : []),
  ]);
  commands.register(createHelpCommand(() => commands.list()));

  // Register slash commands for skills that opt in via their `command` field,
  // and keep them in sync across hot-reloads. A name already taken by another
  // command is left alone (built-ins win).
  const skillCommandNames = new Set<string>();
  const syncSkillCommands = (): void => {
    for (const name of skillCommandNames) commands.unregister(name);
    skillCommandNames.clear();
    for (const skill of skills.list()) {
      if (!skill.command || commands.get(skill.command)) continue;
      commands.register(
        createSkillCommand(skill, { skills, agents, spawn, runs, activeAgent: () => approvals?.activeAgent() }),
      );
      skillCommandNames.add(skill.command);
    }
  };
  syncSkillCommands();

  if (scheduler) await scheduler.start();

  return {
    config,
    models,
    voice,
    plugins,
    sessions,
    agents,
    skills,
    subAgents: runs,
    dispatchSubAgent: async (agent, task, parentId) => {
      const def = agents.get(agent);
      if (!def) throw new Error(`unknown sub-agent "${agent}"`);
      return await runSubAgent(def, task, { spawn, runs, parentId });
    },
    reloadDefinitions: async () => {
      agents.replaceAll(await mergedAgents());
      skills.replaceAll(await mergedSkills());
      syncSkillCommands();
    },
    scheduler,
    tasks,
    commands,
    cwd,
    close: () => {
      scheduler?.stop();
      catalog.close();
    },
  };
};
