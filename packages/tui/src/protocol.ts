import process from 'node:process';

export const CSI = '\x1b[';
export const OSC = '\x1b]';
export const DCS = '\x1bP';
export const APC = '\x1b_';
export const ST = '\x1b\\';
export const BEL = '\x07';

export type TerminalProtocol = 'kitty' | 'iterm2' | 'wezterm' | 'vscode' | 'xterm' | 'basic';

export interface ProtocolResult {
  protocol: TerminalProtocol;
  kittyKeyboard: boolean;
  kittyKeyRelease: boolean;
  iterm2ShellIntegration: boolean;
  sgrMouse: boolean;
  iterm2Buttons: boolean;
  inlineImages: boolean;
}

export function detectTerminalProtocolSync(env: NodeJS.ProcessEnv = process.env): ProtocolResult {
  const program = env.TERM_PROGRAM ?? '';
  const term = env.TERM ?? '';
  const isKitty = Boolean(env.KITTY_WINDOW_ID) || term === 'xterm-kitty';
  const isIterm2 = program === 'iTerm.app' || env.LC_TERMINAL === 'iTerm2';
  const isWezTerm = Boolean(env.WEZTERM_EXECUTABLE) || program === 'WezTerm';
  const isVscode = program === 'vscode';
  const isXtermLike = /xterm|screen|tmux|rxvt|alacritty|foot|ghostty|mintty/i.test(term);

  const protocol: TerminalProtocol = isKitty
    ? 'kitty'
    : isIterm2
    ? 'iterm2'
    : isWezTerm
    ? 'wezterm'
    : isVscode
    ? 'vscode'
    : isXtermLike
    ? 'xterm'
    : 'basic';

  return {
    protocol,
    kittyKeyboard: isKitty,
    kittyKeyRelease: isKitty,
    iterm2ShellIntegration: isIterm2,
    sgrMouse: isXtermLike || isKitty || isIterm2 || isWezTerm || isVscode,
    iterm2Buttons: isIterm2,
    inlineImages: isKitty || isIterm2 || isWezTerm,
  };
}

export function supportsProtocol(result: ProtocolResult, protocol: TerminalProtocol): boolean {
  switch (protocol) {
    case 'kitty':
      return result.kittyKeyboard;
    case 'iterm2':
      return result.iterm2ShellIntegration;
    case 'wezterm':
      return result.protocol === 'wezterm';
    case 'vscode':
      return result.protocol === 'vscode';
    case 'xterm':
      return result.sgrMouse;
    case 'basic':
      return true;
  }
}
