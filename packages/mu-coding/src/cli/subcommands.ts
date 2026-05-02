import { runInstall, runUninstall } from './install';
import { runOutdated, runUpdate } from './update';

/**
 * Handle CLI subcommands that run before the TUI.
 * Returns true if a subcommand was handled (caller should exit).
 */
export async function handleSubcommand(): Promise<boolean> {
  const sub = process.argv[2];

  switch (sub) {
    case 'install':
      await runInstall(process.argv.slice(3));
      return true;
    case 'uninstall':
      await runUninstall(process.argv.slice(3));
      return true;
    case 'update':
    case 'upgrade':
      await runUpdate(process.argv.slice(3));
      return true;
    case 'outdated':
    case 'ping':
      await runOutdated(process.argv.slice(3));
      return true;
    default:
      return false;
  }
}
