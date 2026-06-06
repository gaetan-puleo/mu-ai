import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';

import { parseInput } from './keyboard';

describe('parseInput kitty functional keys', () => {
  it('maps the kitty CSI-u End codepoint to the end key', () => {
    const event = parseInput('\x1b[57357u');
    expect(event?.type).toBe('key');
    if (event?.type !== 'key') return;
    expect(event.key).toBe('end');
    expect(event.ctrl).toBe(false);
  });

  it('decodes ctrl+End from the kitty CSI-u form', () => {
    const event = parseInput('\x1b[57357;5u');
    expect(event?.type).toBe('key');
    if (event?.type !== 'key') return;
    expect(event.key).toBe('end');
    expect(event.ctrl).toBe(true);
  });

  it('decodes ctrl+End from the legacy xterm form', () => {
    const event = parseInput('\x1b[1;5F');
    expect(event?.type).toBe('key');
    if (event?.type !== 'key') return;
    expect(event.key).toBe('end');
    expect(event.ctrl).toBe(true);
  });

  it('maps the remaining kitty navigation codepoints', () => {
    const cases: Record<string, string> = {
      '\x1b[57356u': 'home',
      '\x1b[57350u': 'left',
      '\x1b[57351u': 'right',
      '\x1b[57352u': 'up',
      '\x1b[57353u': 'down',
      '\x1b[57354u': 'pageUp',
      '\x1b[57355u': 'pageDown',
    };
    for (const [raw, key] of Object.entries(cases)) {
      const event = parseInput(raw);
      expect(event?.type).toBe('key');
      if (event?.type !== 'key') continue;
      expect(event.key).toBe(key);
    }
  });
});
