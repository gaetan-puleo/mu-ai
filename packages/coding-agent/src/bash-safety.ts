const READ_ONLY = new Set([
  'ls',
  'pwd',
  'echo',
  'cat',
  'head',
  'tail',
  'wc',
  'stat',
  'file',
  'realpath',
  'readlink',
  'basename',
  'dirname',
  'grep',
  'rg',
  'ag',
  'find',
  'fd',
  'tree',
  'which',
  'type',
  'whoami',
  'id',
  'hostname',
  'uname',
  'date',
  'printenv',
  'sort',
  'uniq',
  'cut',
  'column',
  'comm',
  'diff',
  'cmp',
  'nl',
  'tac',
  'xxd',
  'od',
  'strings',
  'jq',
  'yq',
  'du',
  'df',
  'ps',
  'sha256sum',
  'sha1sum',
  'md5sum',
  'cksum',
  'tr',
]);

const GIT_READ_ONLY = new Set([
  'status',
  'log',
  'diff',
  'show',
  'ls-files',
  'ls-tree',
  'ls-remote',
  'rev-parse',
  'rev-list',
  'blame',
  'describe',
  'shortlog',
  'cat-file',
  'name-rev',
  'grep',
  'show-ref',
  'for-each-ref',
]);

export const EXPLORER_BASH = new Set([
  'bat',
  'eza',
  'exa',
  'lsd',
  'delta',
  'less',
  'more',
  'lsof',
  'pgrep',
  'ctags',
  'cloc',
  'tokei',
  'dust',
  'procs',
  'readelf',
  'nm',
  'objdump',
  'ldd',
  'hexdump',
  'man',
]);

const FIND_MUTATING = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;

// `-o` is sort's only short flag containing the letter `o`, so any short-flag
// cluster that contains it carries an output target — `-o FILE`, the glued
// `-oFILE`, or a bundle like `-bo FILE`. A false positive here only downgrades
// allow→ask (safe); a false negative would auto-allow a file write (unsafe).
const SORT_OUTPUT = /^-[a-z]*o/i;

const writesViaFlag = (head: string, rest: string[]): boolean => {
  if (head === 'find') return rest.some((t) => FIND_MUTATING.test(t));
  if (head === 'sort') {
    return rest.some((t) =>
      (SORT_OUTPUT.test(t) && !t.startsWith('--')) || t === '--output' || t.startsWith('--output=')
    );
  }
  if (head === 'yq' || head === 'jq') return rest.some((t) => t === '-i' || t === '--in-place' || t === '--inplace');
  return false;
};

const segmentIsReadOnly = (segment: string, allowed: Set<string>): boolean => {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  const head = tokens[i];
  if (!head) return false;
  if (head === 'git') {
    const sub = tokens[i + 1];
    return sub !== undefined && GIT_READ_ONLY.has(sub);
  }
  if (writesViaFlag(head, tokens.slice(i + 1))) return false;
  return allowed.has(head);
};

export const isReadOnlyBash = (input: unknown, extra?: Iterable<string>): boolean => {
  const cmd = (input as { cmd?: unknown } | null)?.cmd;
  if (typeof cmd !== 'string' || !cmd.trim()) return false;
  if (/[<>`]/.test(cmd) || cmd.includes('$(')) return false;
  const allowed = extra ? new Set([...READ_ONLY, ...extra]) : READ_ONLY;
  return cmd.split(/\s*(?:&&|\|\||;|\||&)\s*/).every((segment) => segmentIsReadOnly(segment, allowed));
};
