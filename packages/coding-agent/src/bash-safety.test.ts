import { describe, expect, it } from 'vitest';
import { isReadOnlyBash } from './bash-safety';

const ok = (cmd: string): boolean => isReadOnlyBash({ cmd });

describe('isReadOnlyBash', () => {
  it('allows side-effect-free commands', () => {
    for (const cmd of ['ls -la', 'cat file.ts', 'grep -rn foo src', 'rg pattern', 'find . -name "*.ts"', 'pwd']) {
      expect(ok(cmd)).toBe(true);
    }
  });

  it('allows read-only pipelines', () => {
    expect(ok('cat x | grep foo | wc -l')).toBe(true);
    expect(ok('git log --oneline | head -20')).toBe(true);
  });

  it('allows read-only git but not mutating git', () => {
    expect(ok('git status')).toBe(true);
    expect(ok('git diff HEAD~1')).toBe(true);
    expect(ok('git commit -m x')).toBe(false);
    expect(ok('git push')).toBe(false);
    expect(ok('git checkout -b feat')).toBe(false);
  });

  it('asks for mutating or unknown commands', () => {
    for (const cmd of ['rm -rf build', 'npm install', 'deno task test', 'mkdir foo', 'mv a b']) {
      expect(ok(cmd)).toBe(false);
    }
  });

  it('rejects redirections, substitution, and chained mutations', () => {
    expect(ok('echo hi > file')).toBe(false);
    expect(ok('cat $(rm x)')).toBe(false);
    expect(ok('ls && rm x')).toBe(false);
    expect(ok('find . | xargs rm')).toBe(false);
  });

  it('rejects read-only tools that mutate via flags or actions', () => {
    expect(ok('find . -delete')).toBe(false);
    expect(ok('find . -name "*.log" -exec rm {} +')).toBe(false);
    expect(ok('find . -execdir rm {} +')).toBe(false);
    expect(ok('find . -fprint0 out.txt')).toBe(false);
    expect(ok('find . -fprint out.txt')).toBe(false);
    expect(ok('sort -o out.txt in.txt')).toBe(false);
    expect(ok('sort -oout.txt in.txt')).toBe(false);
    expect(ok('sort --output=out.txt in.txt')).toBe(false);
    expect(ok('jq -i . file.json')).toBe(false);
    expect(ok('yq --inplace . file.yaml')).toBe(false);
    expect(ok('find . -name "*.ts" | head')).toBe(true);
    expect(ok('sort file.txt')).toBe(true);
    expect(ok('sort -rn file.txt')).toBe(true);
  });

  it('does not treat env as read-only since it can run any command', () => {
    expect(ok('env rm -rf x')).toBe(false);
    expect(ok('env FOO=bar deno task test')).toBe(false);
    expect(ok('printenv PATH')).toBe(true);
  });

  it('rejects empty or non-string input', () => {
    expect(ok('')).toBe(false);
    expect(isReadOnlyBash({})).toBe(false);
    expect(isReadOnlyBash(null)).toBe(false);
  });
});
