import type { Command, CommandResult, ParsedInput } from './types';

export interface CommandRegistry {
  register(command: Command): void;
  unregister(name: string): void;
  list(): Command[];
  get(name: string): Command | undefined;
  /** Parse a raw input like "/fork 5" into a command + args. Returns undefined if not a command. */
  parse(input: string): ParsedInput | undefined;
  /** Convenience: parse + run. Returns an error result for unknown input. */
  run(input: string, ctx: Record<string, unknown>): Promise<CommandResult>;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();
  const aliasToName = new Map<string, string>();

  function resolve(name: string): Command | undefined {
    const canonical = aliasToName.get(name) ?? name;
    return commands.get(canonical);
  }

  return {
    register(command) {
      if (commands.has(command.name)) {
        throw new Error(`Command "${command.name}" is already registered`);
      }
      for (const alias of command.aliases ?? []) {
        if (commands.has(alias) || aliasToName.has(alias)) {
          throw new Error(`Command alias "${alias}" collides with an existing name or alias`);
        }
      }
      commands.set(command.name, command);
      for (const alias of command.aliases ?? []) aliasToName.set(alias, command.name);
    },

    unregister(name) {
      const cmd = commands.get(name);
      if (!cmd) return;
      commands.delete(name);
      for (const alias of cmd.aliases ?? []) aliasToName.delete(alias);
    },

    list() {
      return [...commands.values()];
    },

    get: resolve,

    parse(input) {
      const trimmed = input.trimStart();
      if (!trimmed.startsWith('/')) return undefined;
      const body = trimmed.slice(1);
      const firstSpace = body.search(/\s/);
      const name = firstSpace === -1 ? body : body.slice(0, firstSpace);
      const rawArgs = firstSpace === -1 ? '' : body.slice(firstSpace + 1).trim();
      const command = resolve(name);
      if (!command) return undefined;
      const args = command.parseArgs ? command.parseArgs(rawArgs) : defaultArgs(rawArgs);
      return { command, args, rawArgs };
    },

    async run(input, ctx) {
      const parsed = this.parse(input);
      if (!parsed) {
        return { ok: false, error: `Unknown command: "${input}"` };
      }
      try {
        return await parsed.command.run(parsed.args, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

function defaultArgs(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/\s+/);
}
