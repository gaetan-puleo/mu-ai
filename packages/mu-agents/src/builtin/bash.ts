import { spawn } from 'node:child_process';
import type { PluginTool } from '../plugin';

function executeBash(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const command = args.command as string;
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
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
        resolve('Aborted');
        return;
      }
      if (code !== 0 && !output) {
        resolve(`Error: Process exited with code ${code}`);
        return;
      }
      resolve(output || '(no output)');
    });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(`Error: ${err.message}`);
    });
  });
}

export const bashTool: PluginTool = {
  definition: {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Execute a bash command and return its output. Use for running commands, installing packages, checking status, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
        },
        required: ['command'],
      },
    },
  },
  display: {
    verb: 'running',
    kind: 'shell',
    fields: { command: 'command' },
  },
  execute: executeBash,
};
