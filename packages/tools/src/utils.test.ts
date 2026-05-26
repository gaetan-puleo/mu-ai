import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizePath } from './utils';

describe('sanitizePath', () => {
  it('returns null when a symlink in cwd points outside cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'sanitize-outside-'));
    try {
      symlinkSync(outside, join(cwd, 'link'));
      const result = sanitizePath('link', cwd, true);
      expect(result).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('returns null when traversing through a symlink that escapes cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-traverse-'));
    const outside = mkdtempSync(join(tmpdir(), 'sanitize-target-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'secret');
      symlinkSync(outside, join(cwd, 'link'));
      const result = sanitizePath('link/secret.txt', cwd, true);
      expect(result).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('returns null for non-existent paths whose existing ancestor is a symlink outside cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-newfile-'));
    const outside = mkdtempSync(join(tmpdir(), 'sanitize-newtarget-'));
    try {
      symlinkSync(outside, join(cwd, 'link'));
      const result = sanitizePath('link/new-file.txt', cwd, true);
      expect(result).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('returns null for ".." escapes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-escape-'));
    try {
      const result = sanitizePath('../etc/passwd', cwd, true);
      expect(result).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('accepts paths that stay inside cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-ok-'));
    try {
      writeFileSync(join(cwd, 'file.txt'), 'ok');
      const result = sanitizePath('file.txt', cwd, true);
      expect(result).not.toBeNull();
      expect(result).toContain('file.txt');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('accepts non-existent write targets inside cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-write-'));
    try {
      const result = sanitizePath('subdir/new-file.txt', cwd, true);
      expect(result).not.toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('strips surrounding quotes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sanitize-quote-'));
    try {
      const result = sanitizePath('"file.txt"', cwd, false);
      expect(result).toContain('file.txt');
      expect(result).not.toContain('"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
