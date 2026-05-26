import type { Component, EventContext, InputEvent, LayoutStyle, RenderContext } from 'mu-tui';
import { truncateToWidth, visibleWidth } from 'mu-tui';
import { getTheme, styleToAnsi } from '../theme';
import type { SubAgentRun } from '../subAgentRun';

const RESET = '\x1b[0m';

export interface SubAgentPreviewProps {
  run: SubAgentRun;
  onClick?: (id: string) => void;
}

/**
 * Two-line block surfaced in the main transcript for each `@<subagent>`
 * dispatch:
 *
 *   ▸ @explorer  Find references to foo
 *     running · rg "foo" packages/
 *
 * Clicking (mouse) opens the sub-agent's isolated transcript.
 */
export class SubAgentPreview implements Component {
  layout: LayoutStyle;
  private hovered = false;

  constructor(private props: SubAgentPreviewProps) {
    this.layout = { width: 'fill', height: 2, padding: { left: 1, right: 1 }, margin: { bottom: 1 } };
  }

  /** Replace the underlying run snapshot — used when the registry notifies an update. */
  update(run: SubAgentRun): void {
    this.props = { ...this.props, run };
  }

  handleEvent(event: InputEvent, _ctx: EventContext): void {
    if (event.type !== 'mouse') return;
    if (event.kind === 'move' || event.kind === 'drag') {
      this.hovered = true;
      return;
    }
    if (event.kind === 'press' && event.button === 'left') {
      this.props.onClick?.(this.props.run.id);
    }
  }

  render(ctx: RenderContext): string[] {
    const { width, height } = ctx.contentRect;
    if (width <= 0 || height <= 0) return [];

    const theme = getTheme(ctx);
    const dim = styleToAnsi({ fg: theme.colors.textMuted });
    const body = styleToAnsi(theme.styles.body);
    const dotSgr = this.props.run.agentColor?.startsWith('#')
      ? styleToAnsi({ fg: this.props.run.agentColor as `#${string}` })
      : '';

    const statusGlyph = statusIcon(this.props.run.status);
    const statusFg = statusColor(theme, this.props.run.status);

    const titlePlain = `${statusGlyph} @${this.props.run.agentName}  ${this.props.run.task}`;
    const titleFitted = visibleWidth(titlePlain) > width
      ? truncateToWidth(titlePlain, width)
      : titlePlain;
    const title = `${statusFg}${statusGlyph}${RESET} ${dotSgr ? dotSgr : ''}@${this.props.run.agentName}${RESET}  ${body}${titleFitted.slice(visibleWidth(`${statusGlyph} @${this.props.run.agentName}  `))}${RESET}`;

    const activityRaw = this.props.run.activity || '…';
    const activityPlain = `    ${activityRaw}`;
    const activityFitted = visibleWidth(activityPlain) > width
      ? `    ${truncateToWidth(activityRaw, Math.max(0, width - 4))}`
      : activityPlain;
    const activity = `${dim}${activityFitted}${RESET}`;

    return height >= 2 ? [title, activity] : [title];
  }
}

function statusIcon(status: SubAgentRun['status']): string {
  switch (status) {
    case 'running':
      return '◐';
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
  }
}

function statusColor(theme: ReturnType<typeof getTheme>, status: SubAgentRun['status']): string {
  switch (status) {
    case 'running':
      return styleToAnsi({ fg: theme.colors.warning });
    case 'completed':
      return styleToAnsi({ fg: theme.colors.success });
    case 'error':
      return styleToAnsi({ fg: theme.colors.danger });
  }
}
