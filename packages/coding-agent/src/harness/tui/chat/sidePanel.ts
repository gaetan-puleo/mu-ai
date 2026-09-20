import { truncateToWidth, type Component } from 'mu-tui';
import { styleToAnsi, type Theme } from './theme';

/**
 * Generic side-panel model. A panel is a list of titled sections; each section is
 * a list of items. An item is a label with an optional value (key/value rows) and
 * an optional status (for live activity). This is the shared shape between the
 * in-process defaults (files + activity) and whatever a remote host (arya) pushes.
 */
export interface PanelItem {
  label: string;
  value?: string;
  status?: 'running' | 'done' | 'error' | 'warning';
  /** Explicit leading glyph; otherwise derived from `status`. */
  marker?: string;
  /** Render in the theme's dim/muted text color. */
  dim?: boolean;
}

export interface PanelSection {
  title: string;
  items: PanelItem[];
}

const RESET = '\x1b[0m';

const statusStyle = (status: PanelItem['status'], theme: Theme): string => {
  if (status === 'running') return styleToAnsi({ fg: theme.colors.accent });
  if (status === 'error') return styleToAnsi({ fg: theme.colors.danger });
  if (status === 'warning') return styleToAnsi({ fg: theme.colors.warning });
  if (status === 'done') return styleToAnsi({ fg: theme.colors.success });
  return '';
};

/**
 * Render a list of generic panel sections into the given surface. Pure view: it
 * reads a snapshot and lays out into whatever width the host hands it.
 */
export const sidePanel = (sections: PanelSection[], theme: Theme, header?: string, footer?: string): Component => ({
  render: (s) => {
    if (s.width <= 0) return;
    s.fill({ x: 0, y: 0, width: s.width, height: s.height }, theme.colors.surface);
    const head = styleToAnsi({ fg: theme.colors.text, bold: true });
    const title = styleToAnsi({ fg: theme.colors.text, bold: true });
    const muted = styleToAnsi({ fg: theme.colors.textMuted });

    let y = 1;
    const line = (text: string, style = ''): void => {
      if (y >= s.height - 1) return;
      s.text(2, y, `${style}${truncateToWidth(text, s.width - 4)}${RESET}`);
      y++;
    };

    if (header) {
      line(header, title);
      y++;
    }

    if (sections.length === 0) {
      line('(empty panel)', muted);
      return;
    }

    for (const section of sections) {
      line(section.title, head);
      if (section.items.length === 0) {
        line('—', muted);
      } else {
        for (const item of section.items) {
          const glyph = item.marker ? `${item.marker} ` : '';
          const style = statusStyle(item.status, theme) || (item.dim ? styleToAnsi(theme.styles.muted) : '');
          const text = item.value ? `${glyph}${item.label}: ${item.value}` : `${glyph}${item.label}`;
          line(text, style);
        }
      }
      y++;
    }

    if (footer && s.height >= 3) {
      s.text(2, s.height - 2, `${muted}${truncateToWidth(footer, s.width - 4)}${RESET}`);
    }
  },
});
