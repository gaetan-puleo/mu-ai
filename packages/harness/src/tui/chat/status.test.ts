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

describe('statusComponent recording indicator', () => {
  it('shows a REC badge, elapsed time and the key hints while recording', () => {
    const line = renderLine(statusComponent({ ...base, recording: { seconds: 65, tick: 0 } }, themesByName.dark));
    expect(line).toContain('REC');
    expect(line).toContain('1:05');
    expect(line).toContain('transcribe');
    expect(line).toContain('cancel');
  });

  it('pulses the dot between ● and ○ on alternating ticks', () => {
    const on = renderLine(statusComponent({ ...base, recording: { seconds: 0, tick: 0 } }, themesByName.dark));
    const off = renderLine(statusComponent({ ...base, recording: { seconds: 0, tick: 1 } }, themesByName.dark));
    expect(on).toContain('●');
    expect(off).toContain('○');
  });

  it('takes priority over the busy spinner', () => {
    const line = renderLine(
      statusComponent(
        { ...base, busy: true, label: 'thinking…', recording: { seconds: 2, tick: 0 } },
        themesByName.dark,
      ),
    );
    expect(line).toContain('REC');
    expect(line).not.toContain('thinking…');
  });
});
