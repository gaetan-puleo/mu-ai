import { spawn } from 'node:child_process';
import { formatError, type Tool, type ToolContext } from 'mu-core';
import { validatedCwd } from './utils';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB
const TRUNCATION_MARKER = '\n…[truncated: output exceeded maxOutputBytes]';
const SIGKILL_DELAY_MS = 1_000;

/**
 * Wire-level args shape declared in the JSON schema below. The runtime parses
 * the JSON for us before calling `execute`, so we still narrow at the boundary
 * (LLMs occasionally emit `{ cmd: 123 }` or omit fields) before trusting
 * `parsed.cmd`.
 */
interface BashArgs {
  cmd?: unknown;
}

interface ExecuteBashOptions {
  cwd: string;
  restrictToCwd: boolean;
  maxOutputBytes: number;
  abortSignal?: AbortSignal;
}

function executeBash(command: string, opts: ExecuteBashOptions): Promise<string> {
  return new Promise((resolve) => {
    // When `restrictToCwd` is on, prefix the command so the spawned shell can't
    // observe a different working directory than the contained one. This is a
    // soft guard — `bash -c` still has access to absolute paths and external
    // tooling — but it ensures relative paths and `pwd` reflect cwd. Containment
    // for path-accepting tools is enforced separately via `sanitizePath`.
    const finalCommand = opts.restrictToCwd ? `set -e; cd ${JSON.stringify(opts.cwd)} && ${command}` : command;

    const proc = spawn('bash', ['-c', finalCommand], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      cwd: opts.cwd,
    });
    // Without `unref`, a detached child keeps the parent's event loop alive
    // after the parent should have exited.
    proc.unref();

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;
    let abortReason: 'timeout' | 'signal' | null = null;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanupTimers = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    const settle = (value: string): void => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (opts.abortSignal) opts.abortSignal.removeEventListener('abort', onAbort);
      resolve(value);
    };

    const killProc = (signal: 'SIGTERM' | 'SIGKILL'): void => {
      if (!proc.pid) return;
      try {
        // Negative PID targets the process group created by `detached: true`,
        // so we terminate children too (e.g. `bash -c 'sleep 60 & wait'`).
        process.kill(-proc.pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
          // Process already gone — fine.
        }
      }
    };

    const beginKill = (reason: 'timeout' | 'signal'): void => {
      if (killed) return;
      killed = true;
      abortReason = reason;
      killProc('SIGTERM');
      // Escalate to SIGKILL if the process doesn't exit promptly.
      killTimer = setTimeout(() => killProc('SIGKILL'), SIGKILL_DELAY_MS);
    };

    timer = setTimeout(() => beginKill('timeout'), DEFAULT_TIMEOUT_MS);

    const onAbort = (): void => beginKill('signal');
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        beginKill('signal');
      } else {
        opts.abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const appendChunk = (stream: 'stdout' | 'stderr', data: Buffer): void => {
      const chunks = stream === 'stdout' ? stdoutChunks : stderrChunks;
      const currentBytes = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const remaining = opts.maxOutputBytes - currentBytes;
      if (remaining <= 0) {
        if (stream === 'stdout') stdoutTruncated = true;
        else stderrTruncated = true;
        return;
      }
      if (data.length <= remaining) {
        chunks.push(data);
        if (stream === 'stdout') stdoutBytes += data.length;
        else stderrBytes += data.length;
        return;
      }
      // Partial fit: keep prefix, mark truncated, and stop the child to bound work.
      chunks.push(data.subarray(0, remaining));
      if (stream === 'stdout') {
        stdoutBytes += remaining;
        stdoutTruncated = true;
      } else {
        stderrBytes += remaining;
        stderrTruncated = true;
      }
      if (!killed) beginKill('signal');
    };

    proc.stdout.on('data', (data: Buffer) => appendChunk('stdout', data));
    proc.stderr.on('data', (data: Buffer) => appendChunk('stderr', data));

    const finalize = (code: number | null): void => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8') + (stdoutTruncated ? TRUNCATION_MARKER : '');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8') + (stderrTruncated ? TRUNCATION_MARKER : '');
      const trimmed = [stdout, stderr].map((s) => s.trim()).filter(Boolean).join('\n');
      if (abortReason === 'timeout') {
        settle(`Error: Process timed out after ${DEFAULT_TIMEOUT_MS / 1000}s${trimmed ? `\n${trimmed}` : ''}`);
        return;
      }
      if (abortReason === 'signal') {
        settle(`Error: Process aborted${trimmed ? `\n${trimmed}` : ''}`);
        return;
      }
      if (code !== 0 && !trimmed) {
        settle(`Error: Process exited with code ${code}`);
        return;
      }
      settle(trimmed || '(no output)');
    };

    proc.on('close', (code) => finalize(code));

    proc.on('error', (err) => {
      // If the process is already settled, this is a late error after close — ignore.
      if (settled) return;
      settle(formatError(err));
    });
  });
}

interface BashToolOptions {
  getCwd: () => string;
  /** When true, the command is run with `cd "$CWD" && …` prefix and refuses to silently leave cwd. */
  restrictToCwd?: boolean;
  /** Cap on combined stdout/stderr bytes. Default 10 MiB. */
  maxOutputBytes?: number;
  /**
   * Per-call abort hook — read once at execute time. Retained for hosts that
   * predate the `ToolContext.signal` plumbing; if both are present we prefer
   * the context signal so the runtime stays in control of cancellation.
   */
  getAbortSignal?: () => AbortSignal | undefined;
}

export function createBashTool(opts: BashToolOptions): Tool<BashArgs, string> {
  const restrictToCwd = opts.restrictToCwd ?? false;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const getCwd = validatedCwd(opts.getCwd);
  const fallbackAbortSignal = opts.getAbortSignal;
  return {
    name: 'bash',
    description: 'Run a shell command via bash in the project cwd. Returns stdout+stderr; non-zero exit is an error.',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
    execute(args, ctx?: ToolContext) {
      // Defensive narrow: schema says `cmd: string`, but cast-without-check is
      // exactly the class of bug finding #149 calls out. If the LLM sends a
      // number or nothing, fall through to onError.
      if (typeof args.cmd !== 'string') {
        return 'Error: bash requires a string `cmd`';
      }
      return executeBash(args.cmd, {
        cwd: getCwd(),
        restrictToCwd,
        maxOutputBytes,
        // Prefer the runtime-supplied signal; fall back to the legacy hook so
        // pre-context hosts (or tests) keep working unchanged.
        abortSignal: ctx?.signal ?? fallbackAbortSignal?.(),
      });
    },
    onError: formatError,
  };
}
