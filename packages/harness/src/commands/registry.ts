import type { Command, CommandContext, CommandRegistry, CommandResult } from './types';

export const createCommandRegistry = (commands: Command[] = []): CommandRegistry => {
  const byName = new Map<string, Command>();
  const aliasToName = new Map<string, string>();

  const resolve = (name: string): Command | undefined => byName.get(aliasToName.get(name) ?? name);

  const register = (command: Command, options: { override?: boolean } = {}): void => {
    const taken = byName.has(command.name) || aliasToName.has(command.name);
    if (taken && !options.override) throw new Error(`Command "${command.name}" is already registered`);
    const existing = byName.get(command.name);
    if (existing) { for (const alias of existing.aliases ?? []) aliasToName.delete(alias); }
    byName.set(command.name, command);
    for (const alias of command.aliases ?? []) {
      if ((byName.has(alias) || aliasToName.has(alias)) && !options.override) {
        throw new Error(`Command alias "${alias}" collides with an existing name or alias`);
      }
      aliasToName.set(alias, command.name);
    }
  };

  for (const command of commands) register(command);

  const parse = (input: string): { command: Command; args: string } | undefined => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/')) return undefined;
    const body = trimmed.slice(1);
    const firstSpace = body.search(/\s/);
    const name = firstSpace === -1 ? body : body.slice(0, firstSpace);
    const args = firstSpace === -1 ? '' : body.slice(firstSpace + 1).trim();
    const command = resolve(name);
    return command ? { command, args } : undefined;
  };

  return {
    register,
    unregister: (name) => {
      const command = byName.get(name);
      if (!command) return;
      byName.delete(name);
      for (const alias of command.aliases ?? []) aliasToName.delete(alias);
    },
    list: () => [...byName.values()],
    get: resolve,
    run: async (input, ctx: CommandContext = {}): Promise<CommandResult> => {
      const parsed = parse(input);
      if (!parsed) return { ok: false, error: `Unknown command: "${input}"` };
      try {
        return await parsed.command.run(parsed.args, ctx);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
};
