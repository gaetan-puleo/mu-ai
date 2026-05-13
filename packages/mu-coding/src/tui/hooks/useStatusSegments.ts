import { useUi } from '../state/AppContext';
import { useTheme } from '../theme/ThemeContext';
import type { StatusBarSegment } from '../components/statusBar';

/**
 * Default chat statusbar segments. Reads `model`, `activeAgent`, `tokens`,
 * and any plugin-registered `status` segments from the React store and
 * shapes them for the prop-based `<StatusBar segments={…} />` API.
 *
 * Equivalent to the inline rendering the previous statusBar.tsx did, but
 * exposed as a hook so non-chat surfaces (e.g. the subagent browser
 * panel) can build their own arrays without sharing this logic.
 */
export function useChatStatusSegments(): StatusBarSegment[] {
  const theme = useTheme();
  const { model, activeAgent, tokens, status } = useUi();
  const segs: StatusBarSegment[] = [];

  // Left zone: model + agent + token counter.
  segs.push({ text: 'model', color: theme.colors.muted, align: 'left' });
  if (model) {
    segs.push({ text: model, color: theme.colors.info, align: 'left' });
  } else {
    segs.push({ text: '(none — /model)', color: theme.colors.muted, dim: true, align: 'left' });
  }
  if (activeAgent) {
    segs.push({ text: activeAgent, color: theme.colors.agentBadge, bold: true, align: 'left' });
  }
  if (tokens) {
    segs.push({
      text: `${tokens.prompt}p / ${tokens.completion}c = ${tokens.total}t`,
      color: theme.colors.muted,
      align: 'left',
    });
  }

  // Right zone: any plugin-registered status segments (flatten the map).
  for (const segGroup of status.values()) {
    for (const s of segGroup) {
      segs.push({ text: s.text, color: s.color, dim: s.dim, bold: s.bold });
    }
  }

  return segs;
}
