import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { looksBinary, readLineRange, sanitizePath, validatedCwd, writeAtomic } from './utils';

describe('sanitizePath', () => {
  it('strips surrounding quotes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-quote-'));
    try {
      const result = sanitizePath('"file.txt"', cwd);
      expect(result).toContain('file.txt');
      expect(result).not.toContain('"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('resolves relative paths against the cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-rel-'));
    try {
      const result = sanitizePath('subdir/file.txt', cwd);
      expect(result).toBe(join(cwd, 'subdir/file.txt'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns absolute paths unchanged', () => {
    const result = sanitizePath('/tmp/absolute.txt');
    expect(result).toBe('/tmp/absolute.txt');
  });
});

describe('looksBinary', () => {
  it('detects a NUL byte as binary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'binary-'));
    try {
      const p = join(dir, 'bin');
      writeFileSync(p, Buffer.from([0x68, 0x69, 0x00, 0x21]));
      expect(looksBinary(p)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats plain ASCII text as non-binary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'text-'));
    try {
      const p = join(dir, 'text.txt');
      writeFileSync(p, 'hello world\nsecond line\n');
      expect(looksBinary(p)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats an empty file as non-binary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-'));
    try {
      const p = join(dir, 'empty');
      writeFileSync(p, '');
      expect(looksBinary(p)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readLineRange', () => {
  it('returns only the requested 1-indexed range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'range-'));
    try {
      const p = join(dir, 'lines.txt');
      writeFileSync(p, 'a\nb\nc\nd\ne\n');
      const r = readLineRange(p, 2, 4);
      expect(r.lines).toEqual(['b', 'c', 'd']);
      expect(r.firstLine).toBe(2);
      expect(r.lastLine).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the entire file when end > total', () => {
    const dir = mkdtempSync(join(tmpdir(), 'range-end-'));
    try {
      const p = join(dir, 'lines.txt');
      writeFileSync(p, 'one\ntwo\nthree');
      const r = readLineRange(p, 1, Number.MAX_SAFE_INTEGER);
      expect(r.lines).toEqual(['one', 'two', 'three']);
      expect(r.totalKnown).toBe(true);
      expect(r.totalLines).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops reading once the requested range is exceeded (avoids loading the whole file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'range-stop-'));
    try {
      const p = join(dir, 'big.txt');
      const longLine = 'x'.repeat(1024);
      const content = Array.from({ length: 1024 }, (_, i) => `${i + 1}-${longLine}`).join('\n');
      writeFileSync(p, content);
      const r = readLineRange(p, 1, 3);
      expect(r.lines.length).toBe(3);
      expect(r.lines[0].startsWith('1-')).toBe(true);
      expect(r.totalKnown).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles the last line without a trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'range-noeol-'));
    try {
      const p = join(dir, 'noeol.txt');
      writeFileSync(p, 'one\ntwo\nthree');
      const r = readLineRange(p, 3, 3);
      expect(r.lines).toEqual(['three']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writeAtomic', () => {
  it('writes the file content and leaves no temp file on success', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    try {
      const p = join(dir, 'out.txt');
      writeAtomic(p, 'hello atomic\n');
      expect(readFileSync(p, 'utf-8')).toBe('hello atomic\n');
      const leftover = readdirSync(dir).filter((f) => f.includes('mu-tmp'));
      expect(leftover).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates missing parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-mkdir-'));
    try {
      const p = join(dir, 'nested/sub/out.txt');
      writeAtomic(p, 'nested');
      expect(existsSync(dirname(p))).toBe(true);
      expect(readFileSync(p, 'utf-8')).toBe('nested');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves raw bytes when a Buffer is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-bin-'));
    try {
      const p = join(dir, 'raw.bin');
      const raw = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
      writeAtomic(p, raw);
      const round = readFileSync(p);
      expect(round.equals(raw)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validatedCwd', () => {
  it("throws when the cwd doesn't exist", () => {
    const accessor = validatedCwd(() => join(tmpdir(), 'definitely-missing-xyz-123'));
    expect(() => accessor()).toThrow(/Invalid cwd/);
  });

  it('throws when the cwd is a file, not a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cwd-file-'));
    try {
      const p = join(dir, 'a-file');
      writeFileSync(p, 'x');
      const accessor = validatedCwd(() => p);
      expect(() => accessor()).toThrow(/Invalid cwd/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the cwd when it is valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cwd-ok-'));
    try {
      const accessor = validatedCwd(() => dir);
      expect(accessor()).toBe(dir);
      expect(accessor()).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
