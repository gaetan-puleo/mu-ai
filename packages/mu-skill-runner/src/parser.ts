/**
 * SKILL.md parser + renderer.
 *
 * A skill is a directory containing a SKILL.md entrypoint. The file uses
 * the standard Agent Skills format (compatible with Claude Code / opencode):
 *
 *   ---
 *   name: my-skill
 *   description: What it does + when to use it
 *   ---
 *
 *   Body markdown. Supports:
 *     - $ARGUMENTS         → full arg string
 *     - $0, $1, ...        → positional args (shell-style quoting)
 *     - $ARGUMENTS[N]      → same as $N
 *     - !`cmd`             → inline shell injection (stdout replaces the call)
 *     - ```!  …  ```       → block shell injection
 *
 * Shell commands run synchronously before the rendered content is returned
 * (so the model only ever sees the resolved output). Failures leave a
 * `[error: ...]` placeholder so the model can still reason about the gap.
 */

import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  /** Reserved for future use; surfaced verbatim so callers can opt in. */
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'allowed-tools'?: string | string[];
  arguments?: string | string[];
  [extra: string]: unknown;
}

export interface ParsedSkill {
  /** Resolved skill name (frontmatter `name`, else directory name). */
  name: string;
  description: string;
  frontmatter: SkillFrontmatter;
  /** Raw body (post-frontmatter, pre-render). */
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseSkillMarkdown(raw: string, fallbackName: string): ParsedSkill | null {
  const fmMatch = raw.match(FRONTMATTER_RE);
  let frontmatter: SkillFrontmatter = {};
  let body = raw;

  if (fmMatch) {
    try {
      const parsed = parseYaml(fmMatch[1] ?? '');
      if (parsed && typeof parsed === 'object') {
        frontmatter = parsed as SkillFrontmatter;
      }
    } catch {
      return null;
    }
    body = raw.slice(fmMatch[0].length);
  }

  const name = typeof frontmatter.name === 'string' && frontmatter.name.length > 0 ? frontmatter.name : fallbackName;

  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';

  return { name, description, frontmatter, body: body.trim() };
}

// ─── Argument substitution ──────────────────────────────────────────────────

interface SplitState {
  cur: string;
  quote: '"' | "'" | null;
  hasContent: boolean;
  out: string[];
}

/** Consume one character while inside a quoted run. Returns how many chars to advance. */
function stepQuoted(input: string, i: number, state: SplitState): number {
  const ch = input[i];
  // Escape inside double quotes: copy next char literally.
  if (ch === '\\' && state.quote === '"' && i + 1 < input.length) {
    state.cur += input[i + 1];
    return 2;
  }
  if (ch === state.quote) {
    state.quote = null;
    return 1;
  }
  state.cur += ch ?? '';
  state.hasContent = true;
  return 1;
}

/** Consume one character while outside any quoted run. */
function stepUnquoted(ch: string, state: SplitState): void {
  if (ch === '"' || ch === "'") {
    state.quote = ch;
    state.hasContent = true;
    return;
  }
  if (ch === ' ' || ch === '\t') {
    if (state.hasContent) {
      state.out.push(state.cur);
      state.cur = '';
      state.hasContent = false;
    }
    return;
  }
  state.cur += ch;
  state.hasContent = true;
}

/**
 * Parse an argument string using shell-style quoting. Handles single/double
 * quotes and basic backslash escapes. Returns the original input as a single
 * element on parse failure (rather than throwing).
 */
export function splitArgs(input: string): string[] {
  const state: SplitState = { cur: '', quote: null, hasContent: false, out: [] };
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    if (state.quote) {
      i += stepQuoted(input, i, state);
      continue;
    }
    stepUnquoted(ch, state);
    i++;
  }
  if (state.hasContent) state.out.push(state.cur);
  return state.out;
}

function substituteArgs(body: string, rawArgs: string): string {
  const positional = splitArgs(rawArgs);
  // Track whether any placeholder was actually replaced so we know whether to
  // append the fallback `ARGUMENTS:` line at the end. We check before doing
  // the regex pass so the answer is independent of substitution side-effects.
  const hasAnyPlaceholder = /\$ARGUMENTS(?:\[\d+\])?|\$\d+/.test(body);

  // Replace $ARGUMENTS[N] first so a literal `$10` isn't eaten by the `$1`
  // rule when only one positional arg was provided.
  let out = body.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx: string) => {
    const n = Number.parseInt(idx, 10);
    return positional[n] ?? '';
  });
  out = out.replace(/\$(\d+)/g, (_, idx: string) => {
    const n = Number.parseInt(idx, 10);
    return positional[n] ?? '';
  });
  // $ARGUMENTS expands to the full raw string.
  if (out.includes('$ARGUMENTS')) {
    out = out.split('$ARGUMENTS').join(rawArgs);
  }
  // Claude Code convention: when the body references no placeholder at all
  // but args were passed, append them so the model still sees them.
  if (!hasAnyPlaceholder && rawArgs.length > 0) {
    out = `${out}\n\nARGUMENTS: ${rawArgs}`;
  }
  return out;
}

// ─── Shell injection ────────────────────────────────────────────────────────

const INLINE_SHELL_RE = /!`([^`\n]+)`/g;
const BLOCK_SHELL_RE = /```!\n([\s\S]*?)\n```/g;

interface ShellOptions {
  cwd: string;
  timeoutMs: number;
}

function runShell(cmd: string, opts: ShellOptions): string {
  try {
    const stdout = execFileSync('bash', ['-c', cmd], {
      cwd: opts.cwd,
      encoding: 'utf-8',
      timeout: opts.timeoutMs,
      // 1MB stdout cap — anything larger is almost certainly a mistake in
      // skill authoring and would balloon the prompt.
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stdout.trimEnd();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[error: ${msg.split('\n')[0] ?? 'shell failed'}]`;
  }
}

function injectShell(body: string, opts: ShellOptions): string {
  // Block form first so its content isn't matched by the inline regex.
  let out = body.replace(BLOCK_SHELL_RE, (_, cmd: string) => runShell(cmd, opts));
  out = out.replace(INLINE_SHELL_RE, (_, cmd: string) => runShell(cmd, opts));
  return out;
}

// ─── Public render entrypoint ───────────────────────────────────────────────

export interface RenderOptions {
  args: string;
  cwd: string;
  /** Set to false to skip `!` shell injection (useful for previews/tests). */
  shell?: boolean;
  /** Per-command timeout. Default 10 s. */
  shellTimeoutMs?: number;
}

export function renderSkillBody(body: string, opts: RenderOptions): string {
  let out = substituteArgs(body, opts.args);
  if (opts.shell !== false) {
    out = injectShell(out, {
      cwd: opts.cwd,
      timeoutMs: opts.shellTimeoutMs ?? 10_000,
    });
  }
  return out;
}
