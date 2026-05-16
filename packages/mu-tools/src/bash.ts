import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from 'mu-core';

function executeBash(command: string, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      cwd,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      try {
        stdout += data.toString('utf-8');
      } catch {
        // skip binary data
      }
    });
    proc.stderr.on('data', (data: Buffer) => {
      try {
        stderr += data.toString('utf-8');
      } catch {
        // skip binary data
      }
    });

    const onAbort = (): void => {
      const pid = proc.pid;
      if (pid) {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          proc.kill('SIGTERM');
        }
        setTimeout(() => {
          if (!proc.killed) {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch {
              proc.kill('SIGKILL');
            }
          }
        }, 500);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      const output = [stdout, stderr]
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
      if (signal?.aborted) {
        resolve({ content: 'Aborted', error: true });
        return;
      }
      if (code !== 0 && !output) {
        resolve({ content: `Error: Process exited with code ${code}`, error: true });
        return;
      }
      // Non-zero exit with output: treat as error so the LLM sees it as such,
      // but preserve stdout/stderr in the content.
      resolve({ content: output || '(no output)', error: code !== 0 });
    });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ content: `Error: ${err.message}`, error: true });
    });
  });
}

interface BashToolOptions {
  getCwd: () => string;
}

export function createBashTool(opts: BashToolOptions): Tool {
  const { getCwd } = opts;
  return {
    name: 'bash',
    description: 'Run a shell command via bash in the project cwd. Returns stdout+stderr; non-zero exit is an error.',
    systemPrompt:
      'Use `bash` for ops without a dedicated tool (rg, build, tests). Avoid using it to read or rewrite files.',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
    matchKey: (args) => (typeof args.cmd === 'string' ? args.cmd : undefined),
    formatArgs: (args) => {
      const cmd = typeof args.cmd === 'string' ? args.cmd : String(args.cmd ?? '');
      const truncated = cmd.length > 200 ? `${cmd.slice(0, 200)}…` : cmd;
      return [{ label: 'cmd', value: truncated }];
    },
    execute(args, signal) {
      return executeBash(args.cmd as string, getCwd(), signal);
    },
  };
}
