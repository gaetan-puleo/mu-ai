import { describe, expect, it } from 'vitest';
import type { Component, Surface } from 'mu-tui';
import { statusComponent, type StatusState } from './status';
import { themesByName } from './theme';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

const renderLine = (component: Component, width = 80): string => {
  let out = '';
  const surface = {
    width,
    height: 1,
    focused: false,
    text: (_x: number, _y: number, value: string) => {
      out = value;
    },
    fill: () => {},
    clear: () => {},
    measure: () => 1,
    child: () => {},
  } as unknown as Surface;
  component.render(surface);
  return stripAnsi(out);
};

const base: StatusState = { label: '', busy: false, spinnerTick: 0, context: '' };

describe('statusComponent', () => {
  it('shows the busy label with a spinner while busy', () => {
    const line = renderLine(statusComponent({ ...base, busy: true, label: 'thinking…' }, themesByName.dark));
    expect(line).toContain('thinking…');
  });

  it('renders empty when idle with no context', () => {
    const line = renderLine(statusComponent(base, themesByName.dark));
    expect(line).toBe('');
  });

  it('shows context on the right when not minimal', () => {
    const line = renderLine(statusComponent({ ...base, context: '12k ctx' }, themesByName.dark));
    expect(line).toContain('12k ctx');
  });
});
