export interface SlashCommand {
  name: string;
  description: string;
  action: string;
}

const COMMANDS: SlashCommand[] = [
  { name: '/model', description: 'Select a model', action: 'model' },
  { name: '/sessions', description: 'List project sessions', action: 'sessions' },
  { name: '/new', description: 'New conversation', action: 'new' },
];

export function matchCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) {
    return [];
  }
  const q = input.toLowerCase();
  return COMMANDS.filter((cmd) => cmd.name.startsWith(q));
}
