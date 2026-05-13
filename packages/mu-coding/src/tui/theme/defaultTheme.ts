import type { Theme } from './types';

export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    text: 'white',
    muted: 'gray',
    background: 'black',

    border: 'gray',
    selection: 'cyan',

    user: 'cyan',
    assistant: 'white',
    system: 'gray',
    tool: 'yellow',

    agent: 'magenta',
    agentBadge: 'magentaBright',

    success: 'green',
    warning: 'yellow',
    error: 'red',
    info: 'blue',

    codeFg: 'white',
    codeBg: 'blackBright',
    link: 'blue',
    heading: 'cyanBright',
    bold: 'white',
    italic: 'whiteBright',
    blockquote: 'gray',
    tableBorder: 'gray',
    diffAdd: 'green',
    diffRemove: 'red',
  },
  badges: {
    user: '▌ you',
    assistant: '▌',
    system: '◆',
    tool: '⚙',
  },
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};
