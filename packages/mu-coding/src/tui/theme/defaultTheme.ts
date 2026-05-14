import type { Theme } from './types';

/**
 * Hex / named-colour palette ported from `5c5ae8c:packages/mu-coding/src/tui/theme/presets.ts`
 * — the v0.15.0 default theme. Migrated from the old nested structure
 * (`theme.input.background`, `theme.toast.defaultColor`, …) to the flat
 * `theme.colors.*` shape we use today, but the *values* are unchanged so
 * the rendered look matches v0.15.0 exactly.
 */
export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    text: 'white',
    muted: 'gray',
    background: 'black',

    border: 'gray',
    // Old dropdown.selected was 'green'; rows highlight green in every
    // list / picker for visual parity.
    selection: 'green',

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

    // markdown: codeBackground '#2a2a2a' + codeText 'yellow' from v0.15.0
    codeFg: 'yellow',
    codeBg: '#2a2a2a',
    // Old markdown.link was 'cyan'.
    link: 'cyan',
    heading: 'cyan',
    bold: 'white',
    italic: 'whiteBright',
    blockquote: 'gray',
    tableBorder: 'gray',
    diffAdd: 'green',
    diffRemove: 'red',

    // toast.background '#1a1a1a', tool.previewBackground '#2a2a2a',
    // dropdown.placeholder 'gray', dropdown.cursor 'white', dialog hint 'gray'.
    toastBackground: '#1a1a1a',
    previewBackground: '#2a2a2a',
    dropdownPlaceholder: 'gray',
    cursor: 'white',
    dialogHint: 'gray',

    statusSeparator: 'gray',

    // input.* from the old theme: background '#222222', commandHighlight
    // 'green', footerHint 'gray', cursor 'white', modelLabel 'white'.
    inputBackground: '#222222',
    inputAccent: 'green',
    inputFooterHint: 'gray',
    inputCursor: 'white',
  },
  badges: {
    user: '▌ you',
    assistant: '▌',
    system: '◆',
    tool: '⚙',
  },
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};
