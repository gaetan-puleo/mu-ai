import type { PluginRegistry } from 'mu-core';
import { parseArgs, resolveInitialMessages } from '../cli/args';
import { handleSubcommand } from '../cli/subcommands';
import { loadConfig } from '../config/index';
import { createRegistry } from '../runtime/createRegistry';
import { checkForUpdatesInBackground } from '../runtime/startupUpdateCheck';
import { InkUIService } from '../tui/plugins/InkUIService';
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

  const initialMessages = resolveInitialMessages(cliArgs);
  const { registry, channels } = await createRegistry({
    cwd: process.cwd(),
    config,
    uiService,
    initialMessages,
    shutdown,
  });
  registryRef = registry;

  // Fire-and-forget npm registry probe — surfaces a toast via uiService.notify
  // if mu or an installed npm plugin has a newer version. Cached for 24h to
  // avoid hammering the registry; disable with MU_NO_UPDATE_CHECK=1.
  void checkForUpdatesInBackground(uiService);

  // The TUI is registered as a `Channel` by `createCodingPlugin`. Starting
  // it mounts Ink with the same options that were captured at activation
  // time (config, initialMessages, registry, messageBus, uiService, shutdown).
  await channels.startAll();
}

export function startApp(): void {
  runApp().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
