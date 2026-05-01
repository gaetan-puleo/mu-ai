import type { CommandContext, SlashCommand as PluginSlashCommand } from 'mu-agents';

export interface SlashCommand {
  name: string;
  description: string;
  action?: string;
  execute?: (args: string) => Promise<string | undefined>;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: '/model', description: 'Select a model', action: 'model' },
  { name: '/sessions', description: 'List project sessions', action: 'sessions' },
  { name: '/new', description: 'New conversation', action: 'new' },
];

export function matchCommands(input: string, pluginCommands: PluginSlashCommand[] = []): SlashCommand[] {
  if (!input.startsWith('/')) {
    return [];
  }
  const q = input.toLowerCase();

  const fromPlugins: SlashCommand[] = pluginCommands.map((pc) => ({
    name: `/${pc.name}`,
    description: pc.description,
    execute: (args: string) => {
      const ctx: CommandContext = { messages: [], cwd: process.cwd(), config: {} as CommandContext['config'] };
      return pc.execute(args, ctx);
    },
  }));

  const all = [...BUILTIN_COMMANDS, ...fromPlugins];
  return all.filter((cmd) => cmd.name.startsWith(q));
}
