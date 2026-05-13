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

  /** Backdrop colour for the toast cards (top-right notifications). */
  toastBackground: string;
  /** Backdrop for the edit_file diff preview / other tool preview blocks. */
  previewBackground: string;
  /** Placeholder colour inside the Dropdown filter / Input dialog. */
  dropdownPlaceholder: string;
  /** Cursor caret colour for in-place text input (Dropdown filter, InputDialog). */
  cursor: string;
  /** Dim helper text under dialogs (e.g. "y/n · Enter to confirm · Esc to cancel"). */
  dialogHint: string;

  /** Separator (` · `) between StatusBar segments. */
  statusSeparator: string;

  /** Backdrop colour of the InputBox container. */
  inputBackground: string;
  /** Inline-picker accent inside the InputBox (selected command/mention row). */
  inputAccent: string;
  /** Right-aligned helper hint inside the InputBox footer. */
  inputFooterHint: string;
  /** Cursor caret colour inside the InputBox. */
  inputCursor: string;
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
