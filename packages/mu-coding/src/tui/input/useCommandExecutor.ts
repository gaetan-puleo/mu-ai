import type { CommandContext, SlashCommand as PluginSlashCommand } from 'mu-core';
import { useCallback, useMemo } from 'react';
import { BUILTIN_COMMANDS, fromPluginCommand, type SlashCommand } from './commands';
import type { InputActions } from './useInputHandler';

interface CommandExecutorOptions {
  actions: InputActions;
  context: CommandContext;
  pluginCommands: PluginSlashCommand[];
}

export function useCommandExecutor(options: CommandExecutorOptions) {
  const { actions, context, pluginCommands } = options;

  const commands = useMemo(
    () => [...BUILTIN_COMMANDS, ...pluginCommands.map((command) => fromPluginCommand(command, context))],
    [context, pluginCommands],
  );

  const execute = useCallback(
    (command: SlashCommand, args: string) => {
      if (command.execute) {
        void command.execute(args);
        return;
      }
      command.invoke?.(actions, args);
    },
    [actions],
  );

  return { commands, execute };
}
