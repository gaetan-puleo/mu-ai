export interface CommandResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface CommandContext {
  sessionId?: string;
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  run: (args: string, ctx: CommandContext) => CommandResult | Promise<CommandResult>;
}

export interface CommandRegistry {
  register(command: Command, options?: { override?: boolean }): void;
  unregister(name: string): void;
  list(): Command[];
  get(name: string): Command | undefined;
  run(input: string, ctx?: CommandContext): Promise<CommandResult>;
}
