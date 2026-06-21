import { describe, expect, it } from 'vitest';

import {
  blendOver,
  colorToRgba,
  DEFAULT_FG,
  indexedColor,
  OPAQUE_BLACK,
  rgbaToSgr,
  rgbColor,
  withOpacity,
} from './color';

describe('color', () => {
  describe('colorToRgba', () => {
    it('converts named colors to indexed intent', () => {
      const red = colorToRgba('red');
      expect(red.intent).toBe('indexed');
      expect(red.index).toBe(1);
      expect(red.a).toBe(1);
    });

    it('parses a 6-digit hex into rgb intent', () => {
      const c = colorToRgba('#ff8000');
      expect(c).toEqual({ r: 0xff, g: 0x80, b: 0x00, a: 1, intent: 'rgb' });
    });

    it('parses a 3-digit hex by doubling each nibble', () => {
      const c = colorToRgba('#abc');
      expect(c).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1, intent: 'rgb' });
    });

    it('parses an 8-digit hex with alpha', () => {
      const c = colorToRgba('#ff000080');
      expect(c.r).toBe(0xff);
      expect(c.a).toBeCloseTo(128 / 255, 3);
      expect(c.intent).toBe('rgb');
    });
  });

  describe('blendOver', () => {
    it('returns back when the front alpha is 0', () => {
      const front = { ...rgbColor(255, 0, 0), a: 0 };
      const back = rgbColor(0, 0, 255);
      expect(blendOver(front, back)).toBe(back);
    });

    it('returns front when the front alpha is 1', () => {
      const front = rgbColor(255, 0, 0);
      const back = rgbColor(0, 0, 255);
      expect(blendOver(front, back)).toBe(front);
    });

    it('blends halfway when the front alpha is 0.5 over an opaque base', () => {
      const front = { ...rgbColor(255, 0, 0), a: 0.5 };
      const back = rgbColor(0, 0, 255);
      const out = blendOver(front, back);
      expect(out.r).toBe(128);
      expect(out.b).toBe(128);
      expect(out.a).toBe(1);
    });

    it('downgrades the intent to rgb when the intents differ', () => {
      const front = { ...colorToRgba('red'), a: 0.5 };
      const back = rgbColor(0, 0, 255);
      expect(blendOver(front, back).intent).toBe('rgb');
    });
  });

  describe('withOpacity', () => {
    it('multiplies the alpha by the opacity factor', () => {
      const c = withOpacity(rgbColor(10, 20, 30, 0.8), 0.5);
      expect(c.a).toBeCloseTo(0.4, 3);
    });
  });

  describe('rgbaToSgr', () => {
    it('emits 39/49 for the default intent', () => {
      expect(rgbaToSgr(DEFAULT_FG, 'fg')).toBe('39');
      expect(rgbaToSgr({ ...DEFAULT_FG, intent: 'default' }, 'bg')).toBe('49');
    });

    it('emits standard ANSI codes for indexed colors 0-7', () => {
      expect(rgbaToSgr(indexedColor(1), 'fg')).toBe('31');
      expect(rgbaToSgr(indexedColor(2), 'bg')).toBe('42');
    });

    it('emits bright codes for indexed colors 8-15', () => {
      expect(rgbaToSgr(indexedColor(9), 'fg')).toBe('91');
    });

    it('emits 256-color codes for higher indices', () => {
      expect(rgbaToSgr(indexedColor(100), 'fg')).toBe('38;5;100');
    });

    it('emits truecolor for the rgb intent', () => {
      expect(rgbaToSgr(rgbColor(255, 128, 0), 'fg')).toBe('38;2;255;128;0');
    });
  });

  it('OPAQUE_BLACK is opaque rgb', () => {
    expect(OPAQUE_BLACK.a).toBe(1);
    expect(OPAQUE_BLACK.intent).toBe('rgb');
  });
});
