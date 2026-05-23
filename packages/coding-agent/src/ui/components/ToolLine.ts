import type { Component, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';

const RESET = '\x1b[0m';

export class ToolLine implements Component {
  layout: LayoutStyle;

  constructor(
    private readonly name: string,
    private readonly argsPreview: string,
  ) {
    this.layout = { width: 'fill', height: 1, padding: { left: 1, right: 1 }, margin: { bottom: 1 } };
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const prefix = styleToAnsi(theme.styles.muted);
    const text = this.argsPreview ? `→ ${this.name} ${this.argsPreview}` : `→ ${this.name}`;
    const fitted = visibleWidth(text) > width ? truncateToWidth(text, width) : text;
    return [prefix ? `${prefix}${fitted}${RESET}` : fitted];
  }
}

export function formatToolCallArgs(toolName: string, rawArgs: string, maxLen = 120): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return truncateText(rawArgs, maxLen);
  }

  if (parsed === null || typeof parsed !== 'object') {
    return truncateText(String(parsed ?? ''), maxLen);
  }

  const args = parsed as Record<string, unknown>;
  const path = stringifyToolArg(args.path);

  if (toolName === 'edit' || toolName === 'write' || toolName === 'read' || toolName === 'list_dir') {
    return truncateText(path, maxLen);
  }

  if (toolName === 'bash') {
    return truncateText(stringifyToolArg(args.cmd), maxLen);
  }

  const parts = Object.values(args)
    .map((value) => stringifyToolArg(value))
    .filter(Boolean);
  return truncateText(parts.join(' '), maxLen);
}

function stringifyToolArg(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyToolArg(item))
      .filter(Boolean)
      .join(' ');
  }
  return JSON.stringify(value) ?? '';
}

function truncateText(value: string, maxLen: number): string {
  return value.length > maxLen ? `${value.slice(0, Math.max(0, maxLen - 1))}…` : value;
}
