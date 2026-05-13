import type { ApprovalChannel, ApprovalDecision, ApprovalRequest } from 'mu-agents';

/**
 * Stdin-based approval prompt. The host CLI is in readline mode, so we read
 * a single response character via raw stdin and then resume readline.
 */
export interface StdinApprovalOptions {
  /** Pause/resume the main readline interface around the prompt. */
  pause: () => void;
  resume: () => void;
}

function formatPrompt(req: ApprovalRequest): string {
  return [
    '',
    '─── approval required ───',
    `agent:  ${req.agentName}`,
    `tool:   ${req.toolName}`,
    `rule:   ${req.matchedRule}`,
    `args:   ${JSON.stringify(req.args)}`,
    '[y]es / [n]o / [a]llow always (this session)? ',
  ].join('\n');
}

function readOneChar(): Promise<string> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer): void => {
      const ch = chunk.toString('utf-8');
      cleanup();
      resolve(ch);
    };
    const cleanup = (): void => {
      process.stdin.off('data', onData);
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          /* not a TTY */
        }
      }
      process.stdin.pause();
    };
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        /* not a TTY */
      }
    }
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

export function createStdinApprovalChannel(opts: StdinApprovalOptions): ApprovalChannel {
  return {
    async request(req): Promise<ApprovalDecision> {
      opts.pause();
      try {
        process.stdout.write(formatPrompt(req));
        const ch = (await readOneChar()).toLowerCase();
        process.stdout.write(`${ch}\n`);
        if (ch === 'a') return { outcome: 'approve', remember: true };
        if (ch === 'y') return { outcome: 'approve' };
        return { outcome: 'deny' };
      } finally {
        opts.resume();
      }
    },
  };
}
