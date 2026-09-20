import process from 'node:process';
import { join } from 'node:path';
import {
  type Agent,
  createApprovalManager,
  createHarness,
  grantArg,
  loadAgents,
  toolDecision,
  variantToChatTemplateKwargs,
} from '../src/harness';
import { createLocalProvider, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-ai-tools';
import { getConfigPath, loadConfig, loadState, xdgDirs } from '../src/config';
import { builtinAgents } from '../src/agents';
import { builtinSkills } from '../src/skills';
import { installPlugin, loadPlugins, uninstallPlugin } from '../src/plugins';
import { BASE_SYSTEM_PROMPT } from '../src/systemPrompt';
import { isReadOnlyBash } from '../src/bash-safety';
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

  const projectAgents = await loadAgents(join(projectLocal, 'agents'));

  // Single main agent: full tool surface, gated by approvals. No persona cycle.
  // `medium` is the reasoning floor — never let a turn fall to the server default.
  // Writes/edits require approval by default; only read-only tools are pre-allowed.
  const MAIN_AGENT: Agent = {
    name: 'mu',
    description: 'The main coding agent.',
    tools: { '*': 'ask', read: 'allow', list: 'allow', write: 'ask', edit: 'ask', subagent: 'allow' },
    variant: 'medium',
    prompt: '',
  };

  const approvals = createApprovalManager();

  const harness = await createHarness({
    hostName: 'mu',
    xdg,
    cwd,
    providers: { local: createLocalProvider(providerConfig) },
    model: initialRef,
    tools: createMuTools({ getCwd: () => cwd }),
    plugins,
    agents: [...projectAgents, ...builtinAgents],
    skills: builtinSkills,
    system: BASE_SYSTEM_PROMPT,
    chatTemplateKwargs: variantToChatTemplateKwargs(MAIN_AGENT.variant),
    sourceUrl: 'https://github.com/gaetan-puleo/mu-ai/tree/main/packages/coding-agent',
    approvals: {
      manager: approvals,
      activeAgent: () => MAIN_AGENT,
      decide: (agent, call) => toolDecision(agent, call.name, grantArg(call.name, call.input)),
      bashGuard: isReadOnlyBash,
    },
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
    approvals,
    providerConfig,
    state,
    capabilities: config.capabilities,
    agent: {
      ref: () => MAIN_AGENT.name,
      color: () => MAIN_AGENT.color,
      cycle: () => MAIN_AGENT.name,
      primaryNames: () => [MAIN_AGENT.name],
    },
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
