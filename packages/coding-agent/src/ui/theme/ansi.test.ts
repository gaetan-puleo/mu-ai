import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { bgToAnsi, fgToAnsi, styleToAnsi, wrapWithStyle } from './ansi';

describe('fgToAnsi', () => {
  it('encodes a 6-digit hex as truecolor SGR', () => {
    expect(fgToAnsi('#ff8000')).toBe('\x1b[38;2;255;128;0m');
  });

  it('encodes a 3-digit hex by expanding it', () => {
    expect(fgToAnsi('#f80')).toBe('\x1b[38;2;255;136;0m');
  });

  it('encodes a named color via the ANSI table', () => {
    expect(fgToAnsi('red')).toBe('\x1b[31m');
    expect(fgToAnsi('brightWhite')).toBe('\x1b[97m');
  });

  it('returns empty string on malformed hex', () => {
    expect(fgToAnsi('#zzzz' as never)).toBe('');
  });
});

describe('bgToAnsi', () => {
  it('encodes a hex as truecolor background SGR', () => {
    expect(bgToAnsi('#10203f')).toBe('\x1b[48;2;16;32;63m');
  });

  it('encodes a named background', () => {
    expect(bgToAnsi('blue')).toBe('\x1b[44m');
  });
});

describe('styleToAnsi', () => {
  it('concatenates style attributes in a stable order', () => {
    expect(styleToAnsi({ bold: true, italic: true, fg: 'red' })).toBe('\x1b[1m\x1b[3m\x1b[31m');
  });

  it('returns "" for an empty style', () => {
    expect(styleToAnsi({})).toBe('');
  });

  it('emits bg and fg when both set', () => {
    expect(styleToAnsi({ fg: '#ffffff', bg: '#000000' })).toBe('\x1b[38;2;255;255;255m\x1b[48;2;0;0;0m');
  });
});

describe('wrapWithStyle', () => {
  it('prepends the SGR and appends a reset', () => {
    expect(wrapWithStyle('hi', { fg: 'red' })).toBe('\x1b[31mhi\x1b[0m');
  });

  it('returns the text unchanged when the style is empty', () => {
    expect(wrapWithStyle('hi', {})).toBe('hi');
  });
});
