import { DEFAULT_THEME } from './presets';
import type { PartialTheme, Theme, ThemeConfig } from './types';

/**
 * Two-level deep merge tailored to the `Theme` shape: each top-level key maps
 * to an object of color leaves (strings), so we never need recursion beyond
 * one nesting level. Keeping it flat avoids accidentally merging into nested
 * structures users haven't opted into and also avoids `any`/recursion that
 * would trip Biome's complexity rules.
 */
function mergeTheme(base: Theme, override?: PartialTheme): Theme {
  if (!override) return base;
  const out: Theme = { ...base };
  const keys = Object.keys(override) as (keyof Theme)[];
  for (const key of keys) {
    mergeSection(out, base, override, key);
  }
  return out;
}

function mergeSection<K extends keyof Theme>(out: Theme, base: Theme, override: PartialTheme, key: K): void {
  const section = override[key];
  if (section && typeof section === 'object') {
    out[key] = { ...base[key], ...section };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve the user-supplied `theme` field from config.json into a fully
 * populated `Theme`. Tolerates malformed input (wrong type) by silently
 * falling back to the default — config corruption should never crash the TUI.
 */
export function resolveTheme(config: ThemeConfig | undefined): Theme {
  if (config === undefined) return DEFAULT_THEME;
  if (!isPlainObject(config)) return DEFAULT_THEME;
  return mergeTheme(DEFAULT_THEME, config as PartialTheme);
}

export { mergeTheme };
