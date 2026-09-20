import { expect, test } from 'vitest';
import type { Surface } from 'mu-tui';
import { sidePanel, type PanelSection } from './sidePanel';
import { themesByName } from './theme';

/** Minimal surface that records text writes into a row-major grid. */
const capture = (width: number, height: number): { surface: Surface; rows: () => string[] } => {
  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(' '));
  const surface: Surface = {
    width,
    height,
    focused: false,
    text: (x, y, value) => {
      if (y < 0 || y >= height) return;
      const plain = value.replace(/\x1b\[[0-9;]*m/g, '');
      for (let i = 0; i < plain.length && x + i < width; i++) grid[y][x + i] = plain[i];
    },
    fill: () => {},
    clear: () => {},
    measure: () => 0,
    child: () => {},
  };
  return { surface, rows: () => grid.map((r) => r.join('').trimEnd()) };
};

const theme = themesByName.dark;

test('sidePanel renders generic sections with labels, values and statuses', () => {
  const sections: PanelSection[] = [
    { title: 'FILES', items: [{ label: 'src/app.ts', marker: '✎' }, { label: 'README.md', marker: '·' }] },
    { title: 'ACTIVITY', items: [{ label: 'researcher', status: 'running' }] },
  ];
  const { surface, rows } = capture(36, 14);
  sidePanel(sections, theme).render(surface);
  const out = rows().join('\n');
  expect(out).toContain('FILES');
  expect(out).toContain('src/app.ts');
  expect(out).toContain('README.md');
  expect(out).toContain('ACTIVITY');
  expect(out).toContain('researcher');
});

test('sidePanel renders key/value items', () => {
  const sections: PanelSection[] = [
    { title: 'INFO', items: [{ label: 'Host', value: 'arya-01' }, { label: 'Uptime', value: '3h' }] },
  ];
  const { surface, rows } = capture(36, 12);
  sidePanel(sections, theme).render(surface);
  const out = rows().join('\n');
  expect(out).toContain('Host: arya-01');
  expect(out).toContain('Uptime: 3h');
});

test('sidePanel shows empty-state per section and for no sections', () => {
  const { surface, rows } = capture(36, 12);
  sidePanel([{ title: 'TASKS', items: [] }], theme).render(surface);
  expect(rows().join('\n')).toContain('TASKS');
  expect(rows().join('\n')).toContain('—');

  const empty = capture(36, 12);
  sidePanel([], theme).render(empty.surface);
  expect(empty.rows().join('\n')).toContain('empty panel');
});

test('sidePanel renders a session title header above the sections', () => {
  const sections: PanelSection[] = [{ title: 'FILES', items: [{ label: 'src/app.ts', marker: '✎' }] }];
  const { surface, rows } = capture(36, 12);
  sidePanel(sections, theme, 'Fix the login bug').render(surface);
  const out = rows();
  expect(out[0]).toBe('');
  expect(out.join('\n')).toContain('Fix the login bug');
  expect(out.join('\n')).toContain('FILES');
});

test('sidePanel renders a context section', () => {
  const sections: PanelSection[] = [
    { title: 'CONTEXT', items: [{ label: '134,509 tokens' }, { label: '51% used' }] },
  ];
  const { surface, rows } = capture(36, 12);
  sidePanel(sections, theme, 'My session').render(surface);
  const out = rows().join('\n');
  expect(out).toContain('CONTEXT');
  expect(out).toContain('134,509 tokens');
  expect(out).toContain('51% used');
});

test('sidePanel truncates long content to the panel width', () => {
  const long = 'a'.repeat(80);
  const { surface, rows } = capture(20, 12);
  sidePanel([{ title: 'X', items: [{ label: long }] }], theme).render(surface);
  for (const row of rows()) expect(row.length).toBeLessThanOrEqual(20);
});
