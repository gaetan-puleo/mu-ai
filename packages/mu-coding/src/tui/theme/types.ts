// Theme type definitions. Kept free of any Ink import so the type can travel
// to `config/index.ts` without dragging the renderer into the config layer.
//
// Color values are plain strings: either an Ink-supported color name
// ("red", "cyan", "yellow"...) or a hex code ("#1a1a1a"). All optional fields
// in `PartialTheme` mirror this so users can override one leaf at a time
// without having to redeclare a full theme.

interface ThemeInput {
  background: string;
  text: string;
  cursor: string;
  commandHighlight: string;
  footerHint: string;
  attachmentName: string;
  attachmentError: string;
  modelLabel: string;
}

interface ThemeUser {
  background: string;
  border: string;
  attachment: string;
}

interface ThemeAssistant {
  text: string;
}

interface ThemeTool {
  success: string;
  error: string;
  previewBackground: string;
  previewText: string;
  summaryDim: string;
  warning: string;
}

interface ThemeReasoning {
  title: string;
  body: string;
}

interface ThemeModal {
  background: string;
  hint: string;
}

interface ThemeToast {
  background: string;
  defaultColor: string;
  closeHint: string;
}

interface ThemeDropdown {
  selected: string;
  description: string;
  placeholder: string;
  cursor: string;
  empty: string;
}

interface ThemeDialog {
  confirmYes: string;
  confirmNo: string;
  hint: string;
  cursor: string;
  placeholder: string;
}

interface ThemeDiff {
  added: string;
  removed: string;
  context: string;
  warning: string;
}

interface ThemeStatus {
  separator: string;
}

interface ThemeMarkdown {
  /** Heading text color (h1/h2/h3 share this color, h1 is also bold). */
  heading: string;
  /** Inline code background. */
  codeBackground: string;
  /** Inline code text color. */
  codeText: string;
  /** Fenced code-block background. */
  codeBlockBackground: string;
  /** Fenced code-block text color. */
  codeBlockText: string;
  /** Link `[label](url)` rendering — label color. */
  link: string;
  /** Blockquote (`> …`) text color (also dimmed). */
  blockquote: string;
  /** List bullet color. */
  bullet: string;
  /** Table border color. */
  tableBorder: string;
}

interface ThemeCommon {
  error: string;
  warning: string;
  success: string;
  accent: string;
  info: string;
}

export interface Theme {
  input: ThemeInput;
  user: ThemeUser;
  assistant: ThemeAssistant;
  tool: ThemeTool;
  reasoning: ThemeReasoning;
  modal: ThemeModal;
  toast: ThemeToast;
  dropdown: ThemeDropdown;
  dialog: ThemeDialog;
  diff: ThemeDiff;
  status: ThemeStatus;
  markdown: ThemeMarkdown;
  common: ThemeCommon;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type PartialTheme = DeepPartial<Theme>;

/**
 * Shape stored in `~/.config/mu/config.json` under the `theme` key. An object
 * with per-leaf overrides on top of the default theme. Kept loose on purpose:
 * malformed input falls back to the default theme rather than throwing.
 */
export type ThemeConfig = PartialTheme;
