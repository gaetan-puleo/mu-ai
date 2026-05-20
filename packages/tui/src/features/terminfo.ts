import { spawnSync } from 'node:child_process';

import { capability, type PartialCapabilities } from '../capabilities';
import type { TuiFeature } from '../feature';

export interface TerminfoFeatureOptions {
  term?: string;
  infocmp?: boolean;
}

export function terminfoFeature(options: TerminfoFeatureOptions = {}): TuiFeature {
  return {
    name: 'terminfo',
    detect(env) {
      const term = options.term ?? env.env.TERM ?? 'dumb';
      const patch = fromTermName(term);
      if (options.infocmp === false) return patch;

      const info = loadInfocmp(term);
      return info ? mergePartial(patch, fromInfocmp(info)) : patch;
    },
  };
}

function fromTermName(term: string): PartialCapabilities {
  const xtermLike = /xterm|tmux|screen|rxvt|alacritty|foot|kitty|wezterm|ghostty|mintty/i.test(term);
  return {
    identity: { term },
    screen: { alternateScreen: capability(xtermLike, xtermLike ? 'env' : 'default') },
    colors: {
      ansi16: capability(term !== 'dumb', term !== 'dumb' ? 'env' : 'default'),
      palette256: capability(term.includes('256color'), term.includes('256color') ? 'env' : 'default'),
    },
    input: {
      bracketedPaste: capability(xtermLike, xtermLike ? 'env' : 'default'),
      focusEvents: capability(xtermLike, xtermLike ? 'env' : 'default'),
    },
    mouse: { sgr: capability(xtermLike, xtermLike ? 'env' : 'default') },
  };
}

function loadInfocmp(term: string): string | null {
  const result = spawnSync('infocmp', ['-x', '-1', term], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout;
}

function fromInfocmp(info: string): PartialCapabilities {
  const has = (needle: string): boolean => info.includes(needle);
  const colorsMatch = info.match(/\bcolors#(\d+)/);
  const colors = colorsMatch ? Number.parseInt(colorsMatch[1], 10) : 0;

  return {
    screen: {
      alternateScreen: capability(has('smcup=') && has('rmcup='), 'terminfo'),
      cursorShape: capability(has('Ss=') || has('Se='), 'terminfo'),
    },
    colors: {
      ansi16: capability(colors >= 8 || has('setaf='), 'terminfo'),
      palette256: capability(colors >= 256, 'terminfo'),
      truecolor: capability(has('RGB') || has('Tc') || has('setrgbf='), 'terminfo'),
      underlineColor: capability(has('Setulc=') || has('Smulx='), 'terminfo'),
    },
    input: {
      xtermModifiedKeys: capability(has('kUP=') || has('kDN=') || has('kLFT=') || has('kRIT='), 'terminfo'),
    },
    osc: {
      clipboard: capability(has('Ms='), 'terminfo'),
    },
  };
}

function mergePartial(a: PartialCapabilities, b: PartialCapabilities): PartialCapabilities {
  return {
    identity: { ...a.identity, ...b.identity },
    screen: { ...a.screen, ...b.screen },
    colors: { ...a.colors, ...b.colors },
    input: { ...a.input, ...b.input },
    mouse: { ...a.mouse, ...b.mouse },
    osc: { ...a.osc, ...b.osc },
    graphics: { ...a.graphics, ...b.graphics },
    security: { ...a.security, ...b.security },
  };
}
