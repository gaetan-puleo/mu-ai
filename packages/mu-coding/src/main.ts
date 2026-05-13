import { parseArgs } from './cli/args';
import { runHelp } from './cli/help';
import { runInstall } from './cli/install';
import { runOutdated } from './cli/outdated';
import { runUpdate } from './cli/update';
import { loadConfig } from './config';
import { startStdinCli } from './stdin';
import { startTui } from './tui-start';

export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  switch (parsed.subcommand) {
    case 'install':
      return runInstall(parsed.args);
    case 'update':
      return runUpdate();
    case 'outdated':
    case 'ping':
      return runOutdated();
    case 'help':
      return runHelp();
    case 'chat':
      return runChat(parsed.sessionId, parsed.model);
  }
}

async function runChat(sessionIdOpt: string | undefined, modelOpt: string | undefined): Promise<void> {
  const config = loadConfig();
  if (modelOpt) config.model = modelOpt;

  const isTTY = !!process.stdout.isTTY;
  if (isTTY) {
    await startTui({ config, sessionIdOpt });
  } else {
    await startStdinCli({ config, sessionIdOpt });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
