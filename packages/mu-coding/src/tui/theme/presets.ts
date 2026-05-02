import type { Theme } from './types';

/**
 * The single built-in theme. Reproduces the exact hard-coded colors that
 * lived inline in the components prior to the theme extraction — using it
 * must be a visual no-op. Users may still override individual leaves via
 * the `theme` field in their config.
 */
export const DEFAULT_THEME: Theme = {
  input: {
    background: '#222222',
    text: 'white',
    cursor: 'white',
    commandHighlight: 'green',
    footerHint: 'gray',
    attachmentName: 'cyan',
    attachmentError: 'red',
    modelLabel: 'white',
  },
  user: {
    background: '#1a1a1a',
    border: 'yellow',
    attachment: 'cyan',
  },
  assistant: {
    text: 'white',
  },
  tool: {
    success: 'green',
    error: 'red',
    previewBackground: '#111111',
    previewText: 'white',
    summaryDim: 'gray',
    warning: 'yellow',
  },
  reasoning: {
    title: 'yellow',
    body: 'gray',
  },
  modal: {
    background: '#1a1a1a',
    hint: 'gray',
  },
  toast: {
    background: '#1a1a1a',
    defaultColor: 'green',
    closeHint: 'gray',
  },
  dropdown: {
    selected: 'green',
    description: 'gray',
    placeholder: 'gray',
    cursor: 'white',
    empty: 'gray',
  },
  dialog: {
    confirmYes: 'green',
    confirmNo: 'red',
    hint: 'gray',
    cursor: 'white',
    placeholder: 'gray',
  },
  diff: {
    added: 'green',
    removed: 'red',
    context: 'gray',
    warning: 'yellow',
  },
  status: {
    separator: 'gray',
  },
  common: {
    error: 'red',
    warning: 'yellow',
    success: 'green',
    accent: 'cyan',
    info: 'blue',
  },
};
