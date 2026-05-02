import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import type { ChatMessage } from 'mu-provider';
import { getLatestSession, loadSession } from '../sessions/index';

interface CliArgs {
  model?: string;
  continueSession?: boolean;
  sessionPath?: string;
}

function printHelp(): never {
  console.log(`mu — minimal terminal AI assistant

Usage:
  mu                            Start interactive chat
  mu -m, --model <model>        Interactive with specific model
  mu -c, --continue             Continue most recent session
  mu --session <path>           Resume a specific session file
  mu install npm:<package>      Install a plugin from npm
  mu uninstall npm:<package>    Remove an installed plugin
  mu -v, --version              Print version and exit
  mu -h, --help                 Show this help

Config (XDG):
  ~/.config/mu/config.json    — configuration (baseUrl, model, streamTimeoutMs)
  ~/.config/mu/SYSTEM.md      — system prompt
  ~/.local/share/mu/sessions/ — saved conversation sessions (JSONL)
  ~/.cache/mu/repomap/        — code index cache

Keyboard shortcuts (interactive):
  Ctrl+C        Abort / Quit (press twice)
  Esc           Stop generation (press twice while streaming)
  Enter         Send message
  Shift+Enter   New line
  Ctrl+S        Send message
  ← / →         Move cursor (Ctrl/Alt+arrow: by word)
  Home/End      Start/end of line (or Ctrl+A / Ctrl+E)
  ↑ / ↓         Move between lines; navigate history at edges
  Backspace/Del Delete around cursor (Ctrl+W word, Ctrl+U/K line)
  Ctrl+N        New conversation
  Ctrl+M        Cycle models
  Ctrl+O        Model picker
  Ctrl+V        Paste image from clipboard`);
  process.exit(0);
}

function printVersion(): never {
  // Walk up from this file to find mu-coding's package.json. Works whether
  // the file is loaded from `src/cli/args.ts` (bun --watch) or `dist/cli/args.js`.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', '..', 'package.json'), join(here, '..', 'package.json')];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf-8'));
      if (pkg?.name === 'mu-coding') {
        console.log(`mu ${pkg.version}`);
        process.exit(0);
      }
    } catch {
      // Try next candidate.
    }
  }
  console.log('mu (version unknown)');
  process.exit(0);
}

export function parseArgs(): CliArgs {
  let parsed: ReturnType<typeof nodeParseArgs>;
  try {
    parsed = nodeParseArgs({
      options: {
        model: { type: 'string', short: 'm' },
        continue: { type: 'boolean', short: 'c' },
        session: { type: 'string' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      // Subcommands like `install`/`uninstall` are routed before parseArgs(),
      // so we shouldn't see them here. Allow positionals just in case the
      // user passes stray args (we ignore them rather than erroring).
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('Run `mu --help` for usage.');
    process.exit(1);
  }

  if (parsed.values.help) {
    printHelp();
  }
  if (parsed.values.version) {
    printVersion();
  }

  return {
    model: typeof parsed.values.model === 'string' ? parsed.values.model : undefined,
    continueSession: parsed.values.continue === true,
    sessionPath: typeof parsed.values.session === 'string' ? parsed.values.session : undefined,
  };
}

export function resolveInitialMessages(cliArgs: CliArgs): ChatMessage[] | undefined {
  if (cliArgs.sessionPath) {
    const msgs = loadSession(cliArgs.sessionPath);
    if (msgs.length === 0) {
      console.error(`Error: session file is empty or not found: ${cliArgs.sessionPath}`);
      process.exit(1);
    }
    return msgs;
  }
  if (cliArgs.continueSession) {
    const latest = getLatestSession();
    if (!latest) {
      console.error('Error: no sessions found');
      process.exit(1);
    }
    const msgs = loadSession(latest);
    if (msgs.length === 0) {
      console.error('Error: latest session is empty');
      process.exit(1);
    }
    console.log(`Resuming session: ${latest}`);
    return msgs;
  }
  return undefined;
}
