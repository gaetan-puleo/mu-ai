import type { InputEvent } from '../events';
import type { EventContext, LayoutStyle, RenderContext } from '../layout/types';
import type { Focusable } from '../types/component';
import { truncateToWidth, visibleWidth } from '../utils';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  layout?: LayoutStyle;
  /** ANSI prefix applied when focused. Default reverse video. */
  focusedPrefix?: string;
  /** ANSI suffix applied when focused. Default reset. */
  focusedSuffix?: string;
}

const DEFAULT_FOCUS_PREFIX = '\x1b[7m';
const DEFAULT_FOCUS_SUFFIX = '\x1b[27m';

/**
 * Single-line clickable / pressable button.
 *
 * - `Enter` or `Space` when focused triggers `onPress`.
 * - Mouse press inside the content rect also triggers `onPress`.
 * - Focusable by default via `layout.focusable`.
 */
export class Button implements Focusable {
  layout: LayoutStyle;
  focused = false;
  private _label: string;
  private readonly onPress?: () => void;
  private readonly focusedPrefix: string;
  private readonly focusedSuffix: string;

  constructor(props: ButtonProps) {
    this._label = props.label;
    this.onPress = props.onPress;
    this.focusedPrefix = props.focusedPrefix ?? DEFAULT_FOCUS_PREFIX;
    this.focusedSuffix = props.focusedSuffix ?? DEFAULT_FOCUS_SUFFIX;
    this.layout = { focusable: true, ...props.layout };
  }

  get label(): string {
    return this._label;
  }

  setLabel(label: string): void {
    this._label = label;
  }

  render(ctx: RenderContext): string[] {
    const { width } = ctx.contentRect;
    if (width <= 0) return [];
    const display = `[ ${this._label} ]`;
    const fitted = visibleWidth(display) > width ? truncateToWidth(display, width) : display;
    if (ctx.focused) {
      return [`${this.focusedPrefix}${fitted}${this.focusedSuffix}`];
    }
    return [fitted];
  }

  handleEvent(event: InputEvent, _ctx: EventContext): void {
    if (event.type === 'key' && (event.key === 'enter' || event.key === ' ' || event.key === 'space')) {
      this.onPress?.();
      return;
    }
    if (event.type === 'mouse' && event.kind === 'press' && event.button === 'left') {
      this.onPress?.();
    }
  }
}
