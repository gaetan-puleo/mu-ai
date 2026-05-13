export interface ParsedArgs {
  subcommand: 'chat' | 'install' | 'update' | 'outdated' | 'ping' | 'help';
  sessionId?: string;
  model?: string;
  /** Positional args following the subcommand. */
  args: string[];
}

/**
 * Parses argv (excluding node/bun + script). Supported:
 *   mu                              → chat
 *   mu --session <id>               → chat resume <id>
 *   mu -m <model> | --model <model> → chat with model override
 *   mu install <spec...>            → install plugin
 *   mu update                       → self+plugins update
 *   mu outdated / ping              → list outdated
 *   mu help                         → help
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { subcommand: 'chat', args: [] };

  const sub = argv[0];
  if (sub === 'install' || sub === 'update' || sub === 'outdated' || sub === 'ping' || sub === 'help') {
    out.subcommand = sub;
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a !== undefined) out.args.push(a);
    }
    return out;
  }

  // chat mode flags
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') {
      out.sessionId = argv[++i];
    } else if (a === '-m' || a === '--model') {
      out.model = argv[++i];
    } else if (a === '--help' || a === '-h') {
      out.subcommand = 'help';
    } else if (a) {
      out.args.push(a);
    }
  }
  return out;
}
