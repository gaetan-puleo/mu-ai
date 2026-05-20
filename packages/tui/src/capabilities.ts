import process from 'node:process';

export type CapabilitySource =
  | 'default'
  | 'env'
  | 'terminfo'
  | 'probe'
  | 'policy'
  | 'feature'
  | 'configured'
  | 'disabled';

export interface Capability<T> {
  value: T;
  source: CapabilitySource;
}

export interface TerminalIdentity {
  term: string;
  program: string;
  multiplexer: 'none' | 'tmux' | 'screen' | 'zellij' | 'unknown';
  transport: 'tty' | 'pipe' | 'ssh' | 'conpty' | 'unknown';
  platform: NodeJS.Platform;
}

export interface ScreenCapabilities {
  alternateScreen: Capability<boolean>;
  synchronizedOutput: Capability<boolean>;
  cursorShape: Capability<boolean>;
}

export interface ColorCapabilities {
  ansi16: Capability<boolean>;
  palette256: Capability<boolean>;
  truecolor: Capability<boolean>;
  underlineColor: Capability<boolean>;
}

export interface InputCapabilities {
  legacy: Capability<boolean>;
  xtermModifiedKeys: Capability<boolean>;
  csiU: Capability<boolean>;
  kittyKeyboard: Capability<boolean>;
  bracketedPaste: Capability<boolean>;
  focusEvents: Capability<boolean>;
}

export interface MouseCapabilities {
  sgr: Capability<boolean>;
  drag: Capability<boolean>;
  motion: Capability<boolean>;
  pixel: Capability<boolean>;
}

export interface OscCapabilities {
  title: Capability<boolean>;
  hyperlinks: Capability<boolean>;
  clipboard: Capability<boolean>;
  shellIntegration: Capability<boolean>;
}

export interface GraphicsCapabilities {
  unicode: Capability<boolean>;
  kitty: Capability<boolean>;
  sixel: Capability<boolean>;
  iterm2: Capability<boolean>;
}

export interface SecurityPolicy {
  hyperlinks: 'deny' | 'allow';
  clipboardWrite: 'deny' | 'ask' | 'allow';
  clipboardRead: 'deny' | 'ask' | 'allow';
  images: 'deny' | 'allow';
  shellIntegration: 'deny' | 'allow';
  maxPayloadBytes: number;
}

export interface Capabilities {
  identity: TerminalIdentity;
  screen: ScreenCapabilities;
  colors: ColorCapabilities;
  input: InputCapabilities;
  mouse: MouseCapabilities;
  osc: OscCapabilities;
  graphics: GraphicsCapabilities;
  security: SecurityPolicy;
}

export type PartialCapabilities = Partial<{
  identity: Partial<TerminalIdentity>;
  screen: Partial<ScreenCapabilities>;
  colors: Partial<ColorCapabilities>;
  input: Partial<InputCapabilities>;
  mouse: Partial<MouseCapabilities>;
  osc: Partial<OscCapabilities>;
  graphics: Partial<GraphicsCapabilities>;
  security: Partial<SecurityPolicy>;
}>;

export function capability<T>(value: T, source: CapabilitySource = 'default'): Capability<T> {
  return { value, source };
}

export function createDefaultCapabilities(env: NodeJS.ProcessEnv = process.env): Capabilities {
  const term = env.TERM ?? 'dumb';
  const program = env.TERM_PROGRAM ?? env.TERMINAL_EMULATOR ?? (env.KITTY_WINDOW_ID ? 'kitty' : 'unknown');
  const multiplexer = detectMultiplexer(env);
  const transport = detectTransport(env);
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
  const modernTerm = /xterm|kitty|wezterm|ghostty|alacritty|foot|tmux|screen|vte|rxvt|iterm|mintty/i.test(term);

  return {
    identity: {
      term,
      program,
      multiplexer,
      transport,
      platform: process.platform,
    },
    screen: {
      alternateScreen: capability(modernTerm, modernTerm ? 'env' : 'default'),
      synchronizedOutput: capability(false),
      cursorShape: capability(false),
    },
    colors: {
      ansi16: capability(term !== 'dumb'),
      palette256: capability(term.includes('256color'), term.includes('256color') ? 'env' : 'default'),
      truecolor: capability(truecolor, truecolor ? 'env' : 'default'),
      underlineColor: capability(false),
    },
    input: {
      legacy: capability(true),
      xtermModifiedKeys: capability(modernTerm, modernTerm ? 'env' : 'default'),
      csiU: capability(false),
      kittyKeyboard: capability(Boolean(env.KITTY_WINDOW_ID), env.KITTY_WINDOW_ID ? 'env' : 'default'),
      bracketedPaste: capability(modernTerm, modernTerm ? 'env' : 'default'),
      focusEvents: capability(modernTerm, modernTerm ? 'env' : 'default'),
    },
    mouse: {
      sgr: capability(modernTerm, modernTerm ? 'env' : 'default'),
      drag: capability(modernTerm, modernTerm ? 'env' : 'default'),
      motion: capability(false),
      pixel: capability(false),
    },
    osc: {
      title: capability(modernTerm, modernTerm ? 'env' : 'default'),
      hyperlinks: capability(modernTerm, modernTerm ? 'env' : 'default'),
      clipboard: capability(false),
      shellIntegration: capability(false),
    },
    graphics: {
      unicode: capability(true),
      kitty: capability(Boolean(env.KITTY_WINDOW_ID), env.KITTY_WINDOW_ID ? 'env' : 'default'),
      sixel: capability(false),
      iterm2: capability(program === 'iTerm.app', program === 'iTerm.app' ? 'env' : 'default'),
    },
    security: {
      hyperlinks: 'allow',
      clipboardWrite: 'deny',
      clipboardRead: 'deny',
      images: 'deny',
      shellIntegration: 'deny',
      maxPayloadBytes: 1024 * 1024,
    },
  };
}

export function mergeCapabilities(base: Capabilities, patch?: PartialCapabilities): Capabilities {
  if (!patch) return base;
  return {
    identity: { ...base.identity, ...patch.identity },
    screen: { ...base.screen, ...patch.screen },
    colors: { ...base.colors, ...patch.colors },
    input: { ...base.input, ...patch.input },
    mouse: { ...base.mouse, ...patch.mouse },
    osc: { ...base.osc, ...patch.osc },
    graphics: { ...base.graphics, ...patch.graphics },
    security: { ...base.security, ...patch.security },
  };
}

function detectMultiplexer(env: NodeJS.ProcessEnv): TerminalIdentity['multiplexer'] {
  if (env.TMUX) return 'tmux';
  if (env.STY) return 'screen';
  if (env.ZELLIJ) return 'zellij';
  return 'none';
}

function detectTransport(env: NodeJS.ProcessEnv): TerminalIdentity['transport'] {
  if (env.SSH_TTY || env.SSH_CONNECTION) return 'ssh';
  if (env.WT_SESSION || process.platform === 'win32') return 'conpty';
  if (process.stdin.isTTY && process.stdout.isTTY) return 'tty';
  return 'pipe';
}
