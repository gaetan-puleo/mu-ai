import { runInstall, runUninstall } from './install';

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
    default:
      return false;
  }
}
