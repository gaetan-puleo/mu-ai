export interface ChatCommand {
  name: string;
  description: string;
  run: (args: string) => void | Promise<void>;
}

export interface CommandHost {
  newSession(): void;
  openModelPicker(): void;
  toggleExpand(): void;
  toggleThinking(): void;
  exportContext(args: string): void | Promise<void>;
  listSessions(): void;
  quit(): void;
}

export function buildCommands(host: CommandHost): ChatCommand[] {
  return [
    { name: 'new', description: 'start a new session', run: () => host.newSession() },
    { name: 'sessions', description: 'open a session from this directory', run: () => host.listSessions() },
    { name: 'model', description: 'switch the active model', run: () => host.openModelPicker() },
    { name: 'thinking', description: 'expand/collapse reasoning blocks', run: () => host.toggleThinking() },
    { name: 'expand', description: 'toggle output block expansion', run: () => host.toggleExpand() },
    {
      name: 'context-export',
      description: 'export the full context (system, tools, messages) to a JSON file',
      run: (args) => host.exportContext(args),
    },
    { name: 'quit', description: 'exit mu', run: () => host.quit() },
  ];
}

export function filterCommands(commands: ChatCommand[], value: string, dismissedFor: string): ChatCommand[] {
  if (!value.startsWith('/') || value.includes(' ') || value === dismissedFor) return [];
  const query = value.slice(1).toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(query));
}
