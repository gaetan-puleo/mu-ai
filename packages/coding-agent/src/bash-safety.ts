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

const FIND_MUTATING = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;

// Env assignments that turn a "read-only" git/pipe into code execution
// (external diff drivers, pagers, ssh command, injected config, loader hijack,
// trace-to-file).
const DANGEROUS_ENV = new Set([
  'PAGER',
  'GIT_PAGER',
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_EXTERNAL_DIFF',
  'EDITOR',
  'VISUAL',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_EXEC_PATH',
  'GIT_TRACE',
  'GIT_TRACE2',
  'GIT_TRACE2_EVENT',
  'GIT_TRACE_SETUP',
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
]);

// Long flags that write files or exec code regardless of git subcommand.
const GIT_DANGEROUS_LONG = [
  '--output',
  '--open-files-in-pager',
  '--upload-pack',
  '--ext-diff',
  '--textconv',
  '--exec-path',
  '--config',
];

// git resolves long flags by unambiguous prefix, so `--up` == `--upload-pack`,
// `--open` == `--open-files-in-pager`, `--text` == `--textconv`. Match by
// prefix: a token that is a prefix of a dangerous flag is treated as dangerous.
// Over-blocking (e.g. `--output-indicator-*` via `--out`) only downgrades
// allow→ask (safe); a false negative would auto-allow exec/write (unsafe).
const gitFlagIsDangerous = (token: string): boolean => {
  const name = token.split('=')[0];
  return GIT_DANGEROUS_LONG.some((d) => d.startsWith(name));
};

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
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
    const name = tokens[i].slice(0, tokens[i].indexOf('='));
    if (DANGEROUS_ENV.has(name)) return false;
    i++;
  }
  const head = tokens[i];
  if (!head) return false;
  if (head === 'git') {
    let j = i + 1;
    const topFlags: string[] = [];
    while (j < tokens.length && tokens[j].startsWith('-')) {
      topFlags.push(tokens[j]);
      j++;
    }
    const sub = tokens[j];
    if (sub === undefined || !GIT_READ_ONLY.has(sub)) return false;
    const rest = tokens.slice(j + 1);
    if (
      topFlags.some((t) => t === '-c' || t.startsWith('--config') || t.startsWith('--exec-path'))
    ) {
      return false;
    }
    for (const t of [...topFlags, ...rest]) {
      if (t.startsWith('--')) {
        if (gitFlagIsDangerous(t)) return false;
      } else if (/^-[a-zA-Z]*O/.test(t)) {
        return false;
      }
    }
    if (sub === 'ls-remote' && rest.some((t) => /^-[a-zA-Z]*u/.test(t) || t.startsWith('--upload-pack'))) {
      return false;
    }
    return true;
  }
  if (writesViaFlag(head, tokens.slice(i + 1))) return false;
  return allowed.has(head);
};

export const isReadOnlyBash = (input: unknown, extra?: Iterable<string>): boolean => {
  const cmd = (input as { cmd?: unknown } | null)?.cmd;
  if (typeof cmd !== 'string' || !cmd.trim()) return false;
  if (/[<>`]/.test(cmd) || cmd.includes('$(')) return false;
  const allowed = extra ? new Set([...READ_ONLY, ...extra]) : READ_ONLY;
  const segments = cmd
    .split(/\s*(?:&&|\|\||;|\||&|[\r\n])\s*/)
    .filter((segment) => segment.trim().length > 0);
  if (segments.length === 0) return false;
  return segments.every((segment) => segmentIsReadOnly(segment, allowed));
};
