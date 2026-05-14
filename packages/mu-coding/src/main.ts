import { loadConfig } from './config';
import { runTui } from './tui';

export interface MainOptions {
  baseUrl?: string;
  model?: string;
}

function parseArgs(argv: string[]): MainOptions {
  const out: MainOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model' || arg === '-m') out.model = argv[++i];
    else if (arg === '--base-url' || arg === '-b') out.baseUrl = argv[++i];
  }
  return out;
}

/**
 * Minimal entry: model picker + Ink chat (transcript + text input) wired to a
 * mu-core session driven by mu-openai-provider.
 *
 * Resolution order (first wins): CLI flag → env var → ~/.config/mu/config.json
 * → built-in default (baseUrl only).
 */
export async function main(argv: string[] = []): Promise<void> {
  const cli = parseArgs(argv);
  const file = loadConfig();
  const baseUrl = cli.baseUrl ?? process.env.MU_BASE_URL ?? file.baseUrl ?? 'http://localhost:11434/v1';
  const model = cli.model ?? process.env.MU_MODEL ?? file.model;
  // Outer try/finally mirrors opencode's `stop()` pattern: even if runTui
  // throws, we have a single place to enforce cross-cutting teardown. The
  // normal exit path already awaits `mu.shutdown()` on its own (see runTui's
  // onClosed bridge), so the finally block stays empty today. It exists so
  // future OS-level cleanup (e.g. a Windows console-mode unguard analogous to
  // win32InstallCtrlCGuard) has an obvious home.
  try {
    await runTui({ baseUrl, model, plugins: file.plugins });
  } finally {
    // intentionally empty — see comment above
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then(() => {
      // Belt-and-suspenders: Ink + ink-text-input can leave stdin in raw mode
      // and/or keep a SIGWINCH listener attached even after Ink's exit() has
      // resolved waitUntilExit(). Provider HTTP keep-alive sockets can also
      // outlive the session. Force a clean exit so users typing /quit don't
      // see a "dead" prompt that never returns.
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
