import { test, expect } from 'vitest';
import { commandPalette } from './components/command-palette';
import { editor } from './components/editor';
import { selectList } from './components/select-list';
import type { InputEvent } from './events';
import { TUI } from './tui';
import type { Terminal } from './types/terminal';
import { column, text } from './views';

const key = (k: string): InputEvent => ({
  type: 'key',
  key: k,
  kind: 'press',
  source: 'legacy',
  raw: '',
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
});

class FakeTerminal implements Terminal {
  columns = 20;
  rows = 4;
  output = '';
  write(data: string): void {
    this.output += data;
  }
  hideCursor(): void {}
  showCursor(): void {}
  clearScreen(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  moveBy(): void {}
}

const plainText = (raw: string): string =>
  raw
    .replace(/\x1b\][0-9];[^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[78]/g, '');

test('TUI renders the root surface into the terminal', () => {
  const term = new FakeTerminal();
  const tui = new TUI(term, { synchronizedOutput: false });
  tui.setRoot(column([text('hello'), text('world')]));
  tui.renderNow();

  const out = plainText(term.output);
  expect(out.includes('hello')).toEqual(true);
  expect(out.includes('world')).toEqual(true);
});

test('a stateful component (editor) receives input', () => {
  const term = new FakeTerminal();
  const tui = new TUI(term, { synchronizedOutput: false });
  const ed = editor({ value: 'hi' });
  tui.setRoot(ed);
  tui.setFocus(ed);

  ed.handleInput({ type: 'text', text: '!', raw: '!' });
  expect(ed.getValue()).toEqual('hi!');

  tui.renderNow();
  expect(plainText(term.output).includes('hi!')).toEqual(true);
});

test('showModal: real modal on top, focus capture, close', () => {
  const term = new FakeTerminal();
  term.columns = 30;
  term.rows = 10;
  const tui = new TUI(term, { synchronizedOutput: false });
  tui.setRoot(text('background'));

  const inner = editor({ value: 'edit' });
  const handle = tui.showModal(inner, { title: 'Confirm' });
  expect(tui.getFocused()).toEqual(inner);

  tui.renderNow();
  const shown = plainText(term.output);
  expect(shown.includes('Confirm')).toEqual(true);
  expect(shown.includes('edit')).toEqual(true);

  handle.close();
  expect(tui.getFocused()).toEqual(null);
  term.output = '';
  tui.renderNow();
  expect(plainText(term.output).includes('Confirm')).toEqual(false);
});

test('selectList navigates by keyboard and selects', () => {
  let chosen = '';
  const list = selectList([
    { label: 'a', value: 'a' },
    { label: 'b', value: 'b' },
    { label: 'c', value: 'c' },
  ]);
  list.onSelect = (item) => {
    chosen = item.value;
  };
  list.handleInput(key('down'));
  list.handleInput(key('enter'));
  expect(chosen).toEqual('b');
});

test('commandPalette filters by typing then runs', () => {
  let ran = '';
  const palette = commandPalette(
    [
      { id: 'open', label: 'Open file', run: () => (ran = 'open') },
      { id: 'save', label: 'Save file', run: () => (ran = 'save') },
      { id: 'quit', label: 'Quit', run: () => (ran = 'quit') },
    ],
    { onRun: (command) => command.run() },
  );
  for (const ch of 'quit') palette.handleInput({ type: 'text', text: ch, raw: ch });
  palette.handleInput(key('enter'));
  expect(ran).toEqual('quit');
});

test('toast: rendered top right then dismissed', () => {
  const term = new FakeTerminal();
  term.columns = 40;
  term.rows = 8;
  const tui = new TUI(term, { synchronizedOutput: false });
  tui.setRoot(text('app'));

  const handle = tui.toast('Saved!', { kind: 'success', duration: 100000 });
  tui.renderNow();
  expect(plainText(term.output).includes('Saved!')).toEqual(true);

  handle.dismiss();
  term.output = '';
  tui.renderNow();
  expect(plainText(term.output).includes('Saved!')).toEqual(false);
});

test('showCommandPalette: layer takes focus, runs and closes', () => {
  const term = new FakeTerminal();
  term.columns = 40;
  term.rows = 12;
  const tui = new TUI(term, { synchronizedOutput: false });
  tui.setRoot(text('app'));

  let ran = '';
  tui.showCommandPalette([
    { id: 'a', label: 'Alpha', run: () => (ran = 'a') },
    { id: 'b', label: 'Beta', run: () => (ran = 'b') },
  ]);
  const palette = tui.getFocused();
  tui.renderNow();
  expect(plainText(term.output).includes('Alpha')).toEqual(true);

  palette?.handleInput?.(key('down'));
  palette?.handleInput?.(key('enter'));
  expect(ran).toEqual('b');
  expect(tui.getFocused()).toEqual(null);
});

test('the cell-diff emits a single change after a full render', () => {
  const term = new FakeTerminal();
  const tui = new TUI(term, { synchronizedOutput: false });
  const label = { value: 'aaaaa' };
  tui.setRoot({ render: (s) => s.text(0, 0, label.value) });

  tui.renderNow();
  term.output = '';
  label.value = 'aaaXa';
  tui.renderNow();

  expect(term.output.includes('X')).toEqual(true);
  expect(term.output.includes('aaaaa')).toEqual(false);
});
