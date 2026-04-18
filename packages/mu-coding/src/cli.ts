import type { ChatMessage } from 'mu-provider';
import { getLatestSession, loadSession } from './session';

interface CliArgs {
  model?: string;
  prompt?: string;
  continueSession?: boolean;
  sessionPath?: string;
}

function printHelp(): never {
  console.log(`mu — minimal terminal AI assistant

Usage:
  mu                  Start interactive chat
  mu -p "prompt"      Single-shot prompt, then exit
  mu -m model -p "p"  Single-shot with specific model
  mu -m model         Interactive with specific model
  mu -c               Continue most recent session
  mu --session <path> Resume a specific session file

Config (XDG):
  ~/.config/mu/config.json  — configuration (baseUrl, model, streamTimeoutMs)
  ~/.config/mu/SYSTEM.md    — system prompt
  ~/.local/share/mu/sessions/ — saved conversation sessions (JSONL)
  ~/.cache/mu/repomap/        — code index cache

Keyboard shortcuts (interactive):
  Ctrl+C  Abort / Quit (press twice)
  Esc     Stop generation (press twice while streaming)
  Enter       Send message
  Shift+Enter New line
  Ctrl+S      Send message
  ↑ / ↓   Navigate input history
  Ctrl+N  New conversation
  Ctrl+M  Cycle models
  Ctrl+O  Model picker
  Ctrl+R  Toggle reasoning`);
  process.exit(0);
}

export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '-p' && args[i + 1]) {
      result.prompt = args[++i];
    } else if (arg === '-c' || arg === '--continue') {
      result.continueSession = true;
    } else if (arg === '--session' && args[i + 1]) {
      result.sessionPath = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
    } else if (!(result.prompt || arg.startsWith('-'))) {
      result.prompt = arg;
    }
  }

  return result;
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
