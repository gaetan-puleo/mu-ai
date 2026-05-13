/**
 * Theme types. The system supports multiple themes in principle; we ship one
 * default (see `defaultTheme.ts`). Plugins or future versions can register
 * additional themes through a registry without changing this contract.
 */

export interface ThemeColors {
  text: string;
  muted: string;
  background: string;

  border: string;
  selection: string;

  user: string;
  assistant: string;
  system: string;
  tool: string;

  agent: string;
  agentBadge: string;

  success: string;
  warning: string;
  error: string;
  info: string;

  codeFg: string;
  codeBg: string;
  link: string;
  heading: string;
  bold: string;
  italic: string;
  blockquote: string;
  tableBorder: string;
  diffAdd: string;
  diffRemove: string;
}

export interface ThemeRoleBadges {
  user: string;
  assistant: string;
  system: string;
  tool: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  badges: ThemeRoleBadges;
  /** Spinner frames for streaming indicators. */
  spinner: string[];
}
