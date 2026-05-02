import { spawn } from 'node:child_process';
import type { PluginTool, ToolExecutorResult } from '../plugin';

function executeBash(command: string, cwd: string, signal?: AbortSignal): Promise<ToolExecutorResult> {
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

    const onAbort = () => {
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

export function createBashTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'bash',
        description:
          'Run a shell command via bash in the project cwd. Returns stdout+stderr; non-zero exit is an error.',
        parameters: {
          type: 'object',
          properties: {
            cmd: { type: 'string' },
          },
          required: ['cmd'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'running',
      kind: 'shell',
      fields: { command: 'cmd' },
    },
    execute(args, signal) {
      return executeBash(args.cmd as string, getCwd(), signal);
    },
  };
}
