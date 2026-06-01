import { spawn } from 'node:child_process';
import { type ContentPart, text, type Tool } from 'mu-core';
import type { ToolFactoryOptions } from './types';
import { formatError, validatedCwd } from './utils';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const TRUNCATION_MARKER = '\n…[truncated: output exceeded maxOutputBytes]';
const SIGKILL_DELAY_MS = 1_000;

interface BashArgs {
  cmd?: unknown;
}

interface ExecuteBashOptions {
  cwd: string;
  maxOutputBytes: number;
  abortSignal?: AbortSignal;
}

function executeBash(command: string, opts: ExecuteBashOptions): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      cwd: opts.cwd,
    });
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
        process.kill(-proc.pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
        }
      }
    };

    const beginKill = (reason: 'timeout' | 'signal'): void => {
      if (killed) return;
      killed = true;
      abortReason = reason;
      killProc('SIGTERM');
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
      if (settled) return;
      settle(formatError(err));
    });
  });
}

interface BashToolOptions extends ToolFactoryOptions {
  maxOutputBytes?: number;
  getAbortSignal?: () => AbortSignal | undefined;
}

export function createBashTool(opts: BashToolOptions): Tool {
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const getCwd = validatedCwd(opts.getCwd);
  const fallbackAbortSignal = opts.getAbortSignal;
  return {
    name: 'bash',
    description: 'Run a shell command via bash in the project cwd. Returns stdout+stderr; non-zero exit is an error.',
    prompt:
      'Use `bash` only for actions no file tool covers. Treat command output already shown in the conversation as current and authoritative — do not re-run a command just to verify it.',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
    async run(input, ctx): Promise<ContentPart[]> {
      const args = (input ?? {}) as BashArgs;
      if (typeof args.cmd !== 'string') {
        return [text('Error: bash requires a string `cmd`')];
      }
      try {
        const result = await executeBash(args.cmd, {
          cwd: getCwd(),
          maxOutputBytes,
          abortSignal: ctx?.signal ?? fallbackAbortSignal?.(),
        });
        return [text(result)];
      } catch (err) {
        return [text(formatError(err))];
      }
    },
  };
}
