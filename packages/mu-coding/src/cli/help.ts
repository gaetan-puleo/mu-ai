export function runHelp(): void {
  const lines = [
    'mu — minimal terminal AI assistant',
    '',
    'Usage:',
    '  mu                            Start interactive chat',
    '  mu --session <id>             Resume a specific session',
    '  mu -m, --model <name>         Override the model for this run',
    '  mu install <spec> [<spec>…]   Install plugins (npm:<name>)',
    '  mu update                     Update mu and installed plugins',
    '  mu outdated, mu ping          List outdated mu / plugins',
    '  mu help, --help, -h           Show this help',
    '',
    'In the chat:',
    '  /help                         List commands',
    '  /sessions                     Pick a session to resume',
    '  /model                        Pick a model',
    '  /update                       Run `mu update` from inside the TUI',
    '  @agent <task>                 Run this one turn under <agent>',
    '  Tab                           Toggle sub-agent browser',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
