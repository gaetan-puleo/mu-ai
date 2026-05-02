import type { CommandContext, SlashCommand as PluginSlashCommand } from 'mu-agents';
import type { InputActions } from './useInputHandler';

/**
 * A slash command can either:
 *  - run via `invoke(actions)` — for builtins that just toggle UI state, or
 *  - run via `execute(args)` — for plugin-supplied commands that produce
 *    side-effects through the agent runtime.
 *
 * Exactly one of `invoke` / `execute` should be set per command.
 */
export interface SlashCommand {
  name: string;
  description: string;
  invoke?: (actions: InputActions) => void;
  execute?: (args: string) => Promise<string | undefined>;
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: '/model', description: 'Select a model', invoke: (a) => a.onTogglePicker?.() },
  { name: '/sessions', description: 'List project sessions', invoke: (a) => a.onToggleSessionPicker?.() },
  { name: '/new', description: 'New conversation', invoke: (a) => a.onNew?.() },
  {
    name: '/context',
    description: 'Show the LLM context (system prompt, messages, tools) as plain text',
    invoke: (a) => a.onShowContext?.(),
  },
];

export function fromPluginCommand(command: PluginSlashCommand, context: CommandContext): SlashCommand {
  return {
    name: `/${command.name}`,
    description: command.description,
    execute: (args: string) => command.execute(args, context),
  };
}

export function matchCommands(input: string, commands: SlashCommand[]): SlashCommand[] {
  if (!input.startsWith('/')) {
    return [];
  }
  const q = input.toLowerCase();
  return commands.filter((cmd) => cmd.name.startsWith(q));
}
