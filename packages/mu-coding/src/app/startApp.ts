import type { PluginRegistry } from 'mu-agents';
import { parseArgs, resolveInitialMessages } from '../cli/args';
import { handleSubcommand } from '../cli/subcommands';
import { loadConfig } from '../config/index';
import { createRegistry } from '../runtime/createRegistry';
import { InkUIService } from '../tui/plugins/InkUIService';
import { renderApp } from '../tui/renderApp';
import { registerShutdown } from './shutdown';

async function runApp(): Promise<void> {
  if (await handleSubcommand()) return;

  const cliArgs = parseArgs();
  const config = loadConfig(cliArgs.model);
  const uiService = new InkUIService();

  // Create the shutdown handle BEFORE the registry so we can pass it into the
  // plugin context. The registry is bound through a thunk, filled in once
  // construction completes.
  let registryRef: PluginRegistry | null = null;
  const shutdown = registerShutdown(() => registryRef);

  const registry = await createRegistry({ cwd: process.cwd(), config, uiService, shutdown });
  registryRef = registry;

  renderApp({
    config,
    initialMessages: resolveInitialMessages(cliArgs),
    registry,
    uiService,
    shutdown,
  });
}

export function startApp(): void {
  runApp().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
