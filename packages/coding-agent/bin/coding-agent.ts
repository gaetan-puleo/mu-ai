#!/usr/bin/env -S deno run -A
import process from 'node:process';
import { join } from 'node:path';
import { createHarness, loadAgents } from 'mu-harness';
import { createLocalProvider, listLocalModels } from 'mu-local-provider';
import { createMuTools } from 'mu-ai-tools';
import { getConfigPath, loadConfig, loadState, xdgDirs } from '../src/config';
import { installPlugin, loadPlugins, uninstallPlugin } from '../src/plugins';
import { buildSystemPrompt } from '../src/systemPrompt';
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
  const promptAgents = [...projectAgents, ...diskAgents, ...plugins.flatMap((p) => p.agents ?? [])];

  const harness = await createHarness({
    hostName: 'mu',
    xdg,
    cwd,
    providers: { local: createLocalProvider(providerConfig) },
    model: initialRef,
    tools: createMuTools({ getCwd: () => cwd }),
    plugins,
    agents: projectAgents,
    system: buildSystemPrompt(promptAgents),
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

  await runApp({ harness, session, providerConfig, state });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
