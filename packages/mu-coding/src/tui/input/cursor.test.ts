import { describe, expect, it } from 'bun:test';
import {
  cursorRowCol,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  insertAt,
  killToLineEnd,
  killToLineStart,
  moveLeft,
  moveLineDown,
  moveLineEnd,
  moveLineHome,
  moveLineUp,
  moveRight,
  moveWordLeft,
  moveWordRight,
  positionAt,
} from './cursor';

const s = (value: string, cursor: number) => ({ value, cursor });

describe('insertAt', () => {
  it('inserts at the cursor and advances it', () => {
    expect(insertAt(s('hello', 5), '!')).toEqual({ value: 'hello!', cursor: 6 });
    expect(insertAt(s('helo', 2), 'l')).toEqual({ value: 'hello', cursor: 3 });
  });
  it('is a no-op for empty text', () => {
    expect(insertAt(s('a', 1), '')).toEqual({ value: 'a', cursor: 1 });
  });
  it('clamps an out-of-range cursor', () => {
    expect(insertAt(s('abc', 99), 'x')).toEqual({ value: 'abcx', cursor: 4 });
  });
});

describe('deleteBackward', () => {
  it('removes the char left of the cursor', () => {
    expect(deleteBackward(s('hello', 5))).toEqual({ value: 'hell', cursor: 4 });
    expect(deleteBackward(s('hello', 1))).toEqual({ value: 'ello', cursor: 0 });
  });
  it('is a no-op at position 0', () => {
    expect(deleteBackward(s('hello', 0))).toEqual({ value: 'hello', cursor: 0 });
  });
});

describe('deleteForward', () => {
  it('removes the char at the cursor', () => {
    expect(deleteForward(s('hello', 0))).toEqual({ value: 'ello', cursor: 0 });
    expect(deleteForward(s('hello', 4))).toEqual({ value: 'hell', cursor: 4 });
  });
  it('is a no-op at end of buffer', () => {
    expect(deleteForward(s('hello', 5))).toEqual({ value: 'hello', cursor: 5 });
  });
});

describe('deleteWordBackward', () => {
  it('eats the previous word', () => {
    expect(deleteWordBackward(s('hello world', 11))).toEqual({ value: 'hello ', cursor: 6 });
    expect(deleteWordBackward(s('hello   world', 13))).toEqual({ value: 'hello   ', cursor: 8 });
  });
  it('eats trailing whitespace before the word', () => {
    expect(deleteWordBackward(s('foo bar  ', 9))).toEqual({ value: 'foo ', cursor: 4 });
  });
  it('is a no-op at start', () => {
    expect(deleteWordBackward(s('foo', 0))).toEqual({ value: 'foo', cursor: 0 });
  });
});

describe('killToLineEnd / killToLineStart', () => {
  it('kills from cursor to end of line', () => {
    expect(killToLineEnd(s('hello\nworld', 3))).toEqual({ value: 'hel\nworld', cursor: 3 });
  });
  it('eats the newline when cursor sits at line end', () => {
    expect(killToLineEnd(s('hello\nworld', 5))).toEqual({ value: 'helloworld', cursor: 5 });
  });
  it('kills from start of line to cursor', () => {
    expect(killToLineStart(s('hello\nworld', 3))).toEqual({ value: 'lo\nworld', cursor: 0 });
    expect(killToLineStart(s('hello\nworld', 8))).toEqual({ value: 'hello\nrld', cursor: 6 });
  });
});

describe('horizontal movement', () => {
  it('moveLeft / moveRight respect bounds', () => {
    expect(moveLeft(s('abc', 0))).toEqual({ value: 'abc', cursor: 0 });
    expect(moveLeft(s('abc', 2))).toEqual({ value: 'abc', cursor: 1 });
    expect(moveRight(s('abc', 3))).toEqual({ value: 'abc', cursor: 3 });
    expect(moveRight(s('abc', 1))).toEqual({ value: 'abc', cursor: 2 });
  });
  it('moveWordLeft / moveWordRight jump across word boundaries', () => {
    expect(moveWordLeft(s('foo bar baz', 11))).toEqual({ value: 'foo bar baz', cursor: 8 });
    expect(moveWordLeft(s('foo bar baz', 8))).toEqual({ value: 'foo bar baz', cursor: 4 });
    expect(moveWordRight(s('foo bar baz', 0))).toEqual({ value: 'foo bar baz', cursor: 3 });
    expect(moveWordRight(s('foo bar baz', 3))).toEqual({ value: 'foo bar baz', cursor: 7 });
  });
  it('Home/End operate on the current line', () => {
    expect(moveLineHome(s('hello\nworld', 8))).toEqual({ value: 'hello\nworld', cursor: 6 });
    expect(moveLineEnd(s('hello\nworld', 6))).toEqual({ value: 'hello\nworld', cursor: 11 });
  });
});

describe('vertical movement', () => {
  it('moveLineUp returns null on first line', () => {
    expect(moveLineUp(s('one\ntwo', 1), null)).toBeNull();
  });
  it('moveLineDown returns null on last line', () => {
    expect(moveLineDown(s('one\ntwo', 5), null)).toBeNull();
  });
  it('preserves desired column across short lines', () => {
    // Cursor on line 0 col 5 → down to line 1 (3 chars) clamps to 3 → down again to line 2 (10 chars) restores 5.
    const start = { value: 'hello\nfoo\nlonglineee', cursor: 5 };
    const down1 = moveLineDown(start, 5);
    expect(down1).toEqual({ value: start.value, cursor: 9 }); // end of "foo"
    const down2 = moveLineDown(down1 as { value: string; cursor: number }, 5);
    expect(down2).toEqual({ value: start.value, cursor: 15 }); // 10 + 5
  });
  it('round-trips up then down to the same offset when desired column is preserved', () => {
    const state = { value: 'aaaa\nbbbb\ncccc', cursor: 12 }; // line 2, col 2
    const up = moveLineUp(state, 2);
    expect(up).toEqual({ value: state.value, cursor: 7 });
    const down = moveLineDown(up as { value: string; cursor: number }, 2);
    expect(down).toEqual({ value: state.value, cursor: 12 });
  });
});

describe('cursorRowCol / positionAt', () => {
  it('reports row and col correctly', () => {
    expect(cursorRowCol('hello\nworld', 0)).toEqual({ row: 0, col: 0 });
    expect(cursorRowCol('hello\nworld', 5)).toEqual({ row: 0, col: 5 });
    expect(cursorRowCol('hello\nworld', 6)).toEqual({ row: 1, col: 0 });
    expect(cursorRowCol('hello\nworld', 11)).toEqual({ row: 1, col: 5 });
  });
  it('positionAt clamps to line length', () => {
    expect(positionAt('hello\nfoo', 1, 99)).toBe(9);
    expect(positionAt('hello\nfoo', 0, 2)).toBe(2);
  });
});
