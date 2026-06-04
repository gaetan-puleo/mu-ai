import { join } from 'node:path';
import process from 'node:process';
import type { Tool } from 'mu-core';
import type { Agent } from '../agents';
import { createAgentRegistry, loadAgents, toolDecision, toolNames } from '../agents';
import {
  createAgentsCommand,
  createCommandRegistry,
  createHelpCommand,
  createSessionsCommand,
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
import {
  createRunSkillTool,
  createSkillRegistry,
  createSkillTool,
  createSkillWriterTool,
  loadSkills,
  runSkill,
} from '../skills';
import { createSubAgentRegistry, createSubAgentTool, runSubAgent } from '../subAgents';
import { createModelRegistry } from './models';
import type { Harness, HarnessOptions } from './types';

const TITLE_AGENT: Agent = {
  name: 'title',
  description: 'Generates a concise session title from the first user message.',
  prompt:
    'Generate a concise title (3 to 6 words) for the conversation based on the user message. Reply with ONLY the title — no quotes, no trailing punctuation, no explanation.',
  tools: [],
};

export const createHarness = async (options: HarnessOptions): Promise<Harness> => {
  const {
    hostName,
    xdg,
    providers,
    model,
    agents: hostAgents = [],
    skills: hostSkills = [],
    title,
    titleModel,
    scheduler: enableScheduler = false,
    approvals,
    ...sessionDefaults
  } = options;
  const cwd = options.cwd ?? process.cwd();
  const config = createHarnessConfig({ hostName, xdg });
  const models = createModelRegistry({ providers, default: model });
  const plugins = createPluginStore({ dir: join(config.configDir, 'plugins') });
  const newId = () => crypto.randomUUID();

  const pluginAgents = (sessionDefaults.plugins ?? []).flatMap((plugin) => plugin.agents ?? []);
  const diskAgents = await loadAgents(join(config.configDir, 'agents'));
  const agents = createAgentRegistry([...hostAgents, ...pluginAgents, ...diskAgents]);

  const skillsDir = join(config.configDir, 'skills');
  const cwdSkillsDir = join(cwd, 'skills');
  const pluginSkills = (sessionDefaults.plugins ?? []).flatMap((plugin) => plugin.skills ?? []);
  const cwdSkills = await loadSkills(cwdSkillsDir);
  const diskSkills = await loadSkills(skillsDir);
  const skills = createSkillRegistry([...hostSkills, ...pluginSkills, ...cwdSkills, ...diskSkills]);
  const skillTools = [
    createSkillTool(skills),
    createSkillWriterTool({ dirs: { local: cwdSkillsDir, config: skillsDir }, registry: skills }),
  ];

  const tasks = enableScheduler ? createTaskStore({ dir: join(config.configDir, 'tasks') }) : undefined;
  let schedulerTools: Tool[] = [];

  const runs = createSubAgentRegistry();
  const store = createSessionStore({ dir: join(config.dataDir, 'sessions') });

  const sessionTools = (
    extra: Tool[] = [],
  ): Tool[] => [...(sessionDefaults.tools ?? []), ...extra, ...skillTools, ...schedulerTools];

  const approvalHook = (getAgent: () => Agent | undefined): AgentSessionHooks | undefined =>
    approvals
      ? approvals.manager.hooksFor({
        decide: (call) => {
          const agent = getAgent();
          if (!agent) return 'allow';
          return approvals.decide ? approvals.decide(agent, call) : toolDecision(agent, call.name);
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
        tools: sessionTools(),
        hooks: mergeHooks([sessionDefaults.hooks, allowList(toolNames(agent)), approvalHook(() => agent)]),
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
        hooks: mergeHooks([sessionDefaults.hooks, approvalHook(() => approvals?.activeAgent())]),
        tools: sessionTools([createSubAgentTool({ registry: agents, spawn, runs, parentId: id })]),
        ...models.resolve(ref),
        id,
        messages,
      }),
  });

  const commands = createCommandRegistry([
    createAgentsCommand(agents),
    createSkillsCommand(skills),
    createSessionsCommand(sessions),
    ...(tasks ? [createTasksCommand(tasks)] : []),
  ]);
  commands.register(createHelpCommand(() => commands.list()));

  if (scheduler) await scheduler.start();

  return {
    config,
    models,
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
