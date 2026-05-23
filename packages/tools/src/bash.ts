import { spawn } from 'node:child_process';
import type { Tool } from 'mu-core';
import { formatError, parseArgs } from './utils';

function executeBash(command: string, cwd: string): Promise<string> {
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

    proc.on('close', (code) => {
      const output = [stdout, stderr]
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
      if (code !== 0 && !output) {
        resolve(`Error: Process exited with code ${code}`);
        return;
      }
      resolve(output || '(no output)');
    });

    proc.on('error', (err) => {
      resolve(formatError(err));
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
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
    execute(args) {
      const parsed = parseArgs(args);
      return executeBash(parsed.cmd as string, getCwd());
    },
    onError: formatError,
  };
}
