/**
 * Slash-command registry. Decouples the set of commands from any particular
 * UI — hosts (or plugins) call `register(command)` at boot, and the UI looks
 * commands up by name. Replaces the hard-coded array pattern hosts used to
 * carry inline.
 *
 * `Command<Ctx>` is generic over a host-supplied context object so each host
 * can hand its commands the dependencies they need (transcript, runtime, …)
 * without the registry caring what's inside.
 */
import { parseCommandLine } from './parser';

/**
 * What a command returns when it runs through the registry. UIs surface the
 * `output` for `ok` results and the `error` message otherwise.
 *
 * Commands that don't surface a result (TUI commands that mutate state and
 * paint via a separate render loop) return nothing from `run` — the registry
 * synthesises `{ ok: true }` for them.
 */
export type CommandResult =
  | { ok: true; output?: string }
  | { ok: false; error: string };

export interface Command<Ctx = unknown> {
  name: string;
  description: string;
  /** Mark commands that should queue rather than run when the runtime is busy. */
  deferWhenBusy?: boolean;
  /**
   * Execute the command. Receives the parsed `args` string + the host context.
   *
   * Return `void` for fire-and-forget commands (the registry treats them as
   * `{ ok: true }`); return a `CommandResult` to surface output/errors back
   * through `registry.run()`.
   */
  run: (args: string, ctx: Ctx) => void | CommandResult | Promise<void | CommandResult>;
}

export interface CommandMatch<Ctx = unknown> {
  command: Command<Ctx>;
  args: string;
}

export interface CommandRegistry<Ctx = unknown> {
  /**
   * Register a command. Throws on duplicate names so hosts notice plugin
   * collisions instead of silently shadowing.
   */
  register(command: Command<Ctx>): void;
  /** Remove a command by name. No-op when the name isn't registered. */
  unregister(name: string): void;
  /** Every registered command, in registration order. UIs use this for palettes. */
  list(): Command<Ctx>[];
  /** Lookup by exact name. */
  get(name: string): Command<Ctx> | undefined;
  /**
   * Parse + resolve in one call. Returns `undefined` when input isn't a
   * command line OR when the command name is unknown — the caller is
   * expected to surface "unknown command" errors when it cares.
   */
  match(input: string): CommandMatch<Ctx> | undefined;
  /**
   * Parse, look up, and execute in one call. Returns `{ ok: false, error }`
   * for malformed input or unknown commands; otherwise returns whatever
   * `command.run` produced (or `{ ok: true }` when it returned `void`).
   *
   * Servers (arya, etc.) call this from their command-dispatch wire handler.
   * UIs that need separate "show in palette" vs "execute" behavior should
   * use `match()` + their own `command.run()` invocation instead.
   */
  run(input: string, ctx: Ctx): Promise<CommandResult>;
}

export function createCommandRegistry<Ctx = unknown>(): CommandRegistry<Ctx> {
  const commands = new Map<string, Command<Ctx>>();
  const order: string[] = [];

  return {
    register(command) {
      if (commands.has(command.name)) {
        throw new Error(`Command "/${command.name}" is already registered`);
      }
      commands.set(command.name, command);
      order.push(command.name);
    },
    unregister(name) {
      if (!commands.delete(name)) return;
      const i = order.indexOf(name);
      if (i >= 0) order.splice(i, 1);
    },
    list() {
      return order.map((name) => commands.get(name)!).filter(Boolean);
    },
    get(name) {
      return commands.get(name);
    },
    match(input) {
      const parsed = parseCommandLine(input);
      if (!parsed) return undefined;
      const command = commands.get(parsed.name);
      if (!command) return undefined;
      return { command, args: parsed.args };
    },
    async run(input, ctx) {
      const parsed = parseCommandLine(input);
      if (!parsed) return { ok: false, error: `Not a command: ${input.slice(0, 40)}` };
      const command = commands.get(parsed.name);
      if (!command) return { ok: false, error: `Unknown command: /${parsed.name}` };
      try {
        const result = await command.run(parsed.args, ctx);
        return result ?? { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
