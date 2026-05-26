export interface CommandResult {
  ok: boolean;
  /** Free-form payload from the command (e.g. a string to display). */
  output?: unknown;
  /** Human-readable error message when `ok === false`. */
  error?: string;
}

export interface Command {
  /** Identifier the user types after the slash: `/new` → "new". */
  name: string;
  /** Short description for help / palette UIs. */
  description: string;
  /** Optional aliases (e.g. `/n` for `/new`). */
  aliases?: string[];
  /**
   * Parse the user input into structured args. Runs after the slash + name
   * are stripped. Default is to split on whitespace; commands can override
   * for richer parsing.
   */
  parseArgs?: (raw: string) => unknown;
  /** Execute the command. */
  run: (args: unknown, ctx: Record<string, unknown>) => CommandResult | Promise<CommandResult>;
}

export interface ParsedInput {
  command: Command;
  args: unknown;
  rawArgs: string;
}
