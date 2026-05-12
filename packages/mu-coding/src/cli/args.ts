import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import type { ChatMessage, SessionStore } from 'mu-core';
import { newSessionId } from 'mu-core';

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
  mu update [plugins|self|all]  Update plugins and/or mu (default: all)
  mu outdated [plugins|self]    List available updates without applying
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
  Tab           Cycle agent
  PageUp/Down   Scroll
`);
  process.exit(0);
}

function printVersion(): never {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const pkgPath = join(dirname(__filename), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    console.log(pkg.version ?? 'unknown');
  } catch {
    console.log('unknown');
  }
  process.exit(0);
}

export function parseArgs(): CliArgs {
  let parsed: ReturnType<typeof nodeParseArgs>;
  try {
    parsed = nodeParseArgs({
      args: process.argv.slice(2),
      options: {
        model: { type: 'string', short: 'm' },
        continue: { type: 'boolean', short: 'c' },
        session: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
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

interface InitialSession {
  sessionId: string;
  messages?: ChatMessage[];
}

/**
 * Resolve the initial session from CLI args using the core SessionStore.
 * Returns the session id and optional messages for resumed sessions.
 */
export function resolveInitialSession(cliArgs: CliArgs, store: SessionStore): InitialSession {
  if (cliArgs.sessionPath) {
    // Derive session id from the file stem.
    const id = basename(cliArgs.sessionPath, '.jsonl');
    const stored = store.get(id);
    if (!stored || stored.messages.length === 0) {
      console.error(`Error: session file is empty or not found: ${cliArgs.sessionPath}`);
      process.exit(1);
    }
    return { sessionId: id, messages: stored.messages };
  }
  if (cliArgs.continueSession) {
    const all = store.list();
    if (all.length === 0) {
      console.error('Error: no sessions found');
      process.exit(1);
    }
    const latest = all[0]!;
    const stored = store.get(latest.id);
    if (!stored || stored.messages.length === 0) {
      console.error('Error: latest session is empty');
      process.exit(1);
    }
    console.log(`Resuming session: ${latest.id}`);
    return { sessionId: latest.id, messages: stored.messages };
  }
  return { sessionId: newSessionId() };
}
