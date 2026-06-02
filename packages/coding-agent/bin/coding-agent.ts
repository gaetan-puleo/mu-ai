#!/usr/bin/env -S deno run -A
import process from 'node:process';
import { join } from 'node:path';
import { type Agent, type AgentSessionHooks, createHarness, filterTools, loadAgents, type PreparedRequest } from 'mu-harness';
import { createLocalProvider, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-ai-tools';
import { getConfigPath, loadConfig, loadState, xdgDirs } from '../src/config';
import { builtinAgents } from '../src/agents';
import { installPlugin, loadPlugins, uninstallPlugin } from '../src/plugins';
import { BASE_SYSTEM_PROMPT } from '../src/systemPrompt';
import { runApp } from '../src/main';

const normalizeModel = (model?: string): string | undefined => {
  if (!model) return undefined;
  return model.includes('/') ? model : `local/${model}`;
};

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const [cmd, arg] = args;

  if (cmd === 'install') {
    if (!arg) throw new Error('usage: mu install <npm:spec | jsr:spec | ./path.ts>');
    installPlugin(arg);
    return;
  }
  if (cmd === 'uninstall') {
    if (!arg) throw new Error('usage: mu uninstall <spec>');
    uninstallPlugin(arg);
    return;
  }

  const wantContinue = args.includes('-c') || args.includes('--continue');

  const config = loadConfig();
  const state = loadState();

  if (!config.baseUrl) {
    throw new Error(
      `Missing baseUrl in config. Create ${getConfigPath()} with { "kind": "llama-swap", "baseUrl": "http://..." }`,
    );
  }

  const xdg = xdgDirs();
  const cwd = process.cwd();
  const projectLocal = join(cwd, '.mu');
  const providerConfig = { kind: config.kind, baseUrl: config.baseUrl, apiKey: config.apiKey };

  let initialRef = normalizeModel(state.model);
  if (!initialRef) {
    try {
      const models = await listLocalModels(providerConfig);
      initialRef = models[0] ? `local/${models[0].id}` : 'local/default';
    } catch {
      initialRef = 'local/default';
    }
  }

  const plugins = await loadPlugins(config.plugins);

  const diskAgents = await loadAgents(join(xdg.configHome, 'mu', 'agents'));
  const projectAgents = await loadAgents(join(projectLocal, 'agents'));
  const loadedAgents = [...projectAgents, ...diskAgents, ...plugins.flatMap((p) => p.agents ?? [])];
  const promptAgents = [...loadedAgents];
  for (const agent of builtinAgents) {
    if (!promptAgents.some((a) => a.name === agent.name)) promptAgents.push(agent);
  }

  const byName = new Map(promptAgents.map((a) => [a.name, a] as const));
  const wanted = config.primaryAgents ?? ['build', 'plan'];
  const resolved = wanted.map((n) => byName.get(n)).filter((a): a is Agent => a !== undefined);
  const cycle: Agent[] = resolved.length > 0 ? resolved : builtinAgents;
  let agentIndex = 0;
  const currentAgent = (): Agent => cycle[agentIndex];
  let lastAgentName: string | undefined;
  const primaryHook: AgentSessionHooks = {
    prepareRequest: ({ system, tools }) => {
      const agent = currentAgent();
      const switched = lastAgentName !== undefined && lastAgentName !== agent.name;
      lastAgentName = agent.name;
      const prepared: PreparedRequest = {
        system: `${system}\n\n${agent.prompt}`,
        tools: agent.tools ? filterTools(tools, agent.tools) : tools,
      };
      if (switched) {
        prepared.messages = [{
          role: 'user',
          content: [{ type: 'text', text: `<system-reminder>changed to ${agent.name} agent</system-reminder>` }],
        }];
      }
      return prepared;
    },
  };

  const harness = await createHarness({
    hostName: 'mu',
    xdg,
    cwd,
    providers: { local: createLocalProvider(providerConfig) },
    model: initialRef,
    tools: createMuTools({ getCwd: () => cwd }),
    plugins,
    agents: [...projectAgents, ...builtinAgents],
    system: BASE_SYSTEM_PROMPT,
    hooks: primaryHook,
  });

  let session;
  if (wantContinue) {
    const recent = await harness.sessions.list({ cwd });
    if (recent[0]) {
      session = await harness.sessions.open(recent[0].id);
    } else {
      process.stderr.write('[mu] no previous session to resume; starting a new one\n');
      session = harness.sessions.create();
    }
  } else {
    session = harness.sessions.create();
  }

  await runApp({
    harness,
    session,
    providerConfig,
    state,
    agent: {
      ref: () => currentAgent().name,
      color: () => currentAgent().color,
      cycle: () => {
        agentIndex = (agentIndex + 1) % cycle.length;
        return cycle[agentIndex].name;
      },
      primaryNames: () => cycle.map((a) => a.name),
    },
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
