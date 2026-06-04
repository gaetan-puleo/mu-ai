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
  'env',
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
  return allowed.has(head);
};

export const isReadOnlyBash = (input: unknown, extra?: Iterable<string>): boolean => {
  const cmd = (input as { cmd?: unknown } | null)?.cmd;
  if (typeof cmd !== 'string' || !cmd.trim()) return false;
  if (/[<>`]/.test(cmd) || cmd.includes('$(')) return false;
  const allowed = extra ? new Set([...READ_ONLY, ...extra]) : READ_ONLY;
  return cmd.split(/\s*(?:&&|\|\||;|\||&)\s*/).every((segment) => segmentIsReadOnly(segment, allowed));
};
