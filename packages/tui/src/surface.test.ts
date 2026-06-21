import { test, expect } from 'vitest';
import { box, text } from './views';
import { createCellBuffer, getCell } from './layout/cellbuffer';
import { renderToBuffer } from './surface';

test('an opaque box background erases content behind it (no bleed-through)', () => {
  const buf = createCellBuffer(10, 2, { r: 0, g: 0, b: 0, a: 1, intent: 'rgb' });
  renderToBuffer({ render: (s) => s.text(0, 0, 'XXXXXXXXXX') }, buf);
  renderToBuffer({
    render: (s) => s.child(box(text('hi'), { background: '#123456' }), { x: 0, y: 0, width: 6, height: 1 }),
  }, buf);

  expect(getCell(buf, 0, 0).grapheme).toEqual('h');
  expect(getCell(buf, 4, 0).grapheme).toEqual(' ');
  expect(getCell(buf, 4, 0).style.bg).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1, intent: 'rgb' });
});

test('a translucent box background tints content instead of erasing it', () => {
  const buf = createCellBuffer(10, 1, { r: 0, g: 0, b: 0, a: 1, intent: 'rgb' });
  renderToBuffer({ render: (s) => s.text(0, 0, 'XXXXXXXXXX') }, buf);
  renderToBuffer({
    render: (s) =>
      s.child(box(text(''), { background: '#ffffff', backgroundOpacity: 0.5 }), { x: 0, y: 0, width: 6, height: 1 }),
  }, buf);

  expect(getCell(buf, 4, 0).grapheme).toEqual('X');
});
