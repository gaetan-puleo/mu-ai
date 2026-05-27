import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { OutputBlock } from '../components/OutputBlock';
import type { CommandPaletteItem } from '../components/CommandPalette';
import type { Transcript } from '../Transcript';
import type { RoundtripStore } from 'mu-harness';
import type { Theme } from '../theme';

export interface ChatCommand extends CommandPaletteItem {
  run: (args: string) => void;
  deferWhenBusy?: boolean;
}

export interface CommandsHost {
  startNewSession: () => void;
  openModelModal: () => void;
  exportContext: (args: string) => void;
  toggleThinking: () => void;
  toggleOutputBlocks: () => void;
  stopAndExit: (code: number) => void;
}

/** The fixed slash-command set. Order here drives the palette layout. */
export function createCommands(host: CommandsHost): ChatCommand[] {
  return [
    { name: 'new', description: 'start a new session', run: () => host.startNewSession() },
    { name: 'model', description: 'switch the active model', run: () => host.openModelModal() },
    {
      name: 'context-export',
      description: 'export context map to a file',
      deferWhenBusy: true,
      run: (args) => host.exportContext(args),
    },
    {
      name: 'thinking',
      description: 'toggle thinking blocks',
      deferWhenBusy: true,
      run: () => host.toggleThinking(),
    },
    {
      name: 'expand',
      description: 'toggle output block expansion',
      deferWhenBusy: true,
      run: () => host.toggleOutputBlocks(),
    },
    { name: 'quit', description: 'exit the agent', run: () => host.stopAndExit(0) },
  ];
}

export function filterCommands(items: ChatCommand[], value: string, dismissedFor: string): ChatCommand[] {
  if (!value.startsWith('/') || value.includes(' ') || value === dismissedFor) return [];
  const query = value.slice(1).toLowerCase();
  return items.filter((command) => command.name.toLowerCase().startsWith(query));
}

/** Run a shell command, append a live OutputBlock to the transcript, and refresh. */
export function runShellCommand(opts: {
  cmd: string;
  transcript: Transcript;
  theme: Theme;
  onRender: () => void;
}): void {
  const entry = {
    role: 'output_block' as const,
    component: new OutputBlock({ command: opts.cmd, output: '', theme: opts.theme }),
  };
  opts.transcript.lines.push(entry);
  opts.onRender();

  let stdout = '';
  let stderr = '';
  const proc = spawn('bash', ['-c', opts.cmd], { stdio: ['pipe', 'pipe', 'pipe'] });

  proc.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString('utf-8');
  });
  proc.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString('utf-8');
  });
  proc.on('close', (code) => {
    const output = code !== 0 || stderr ? [stdout, stderr].filter(Boolean).join('\n') : stdout;
    entry.component = new OutputBlock({
      command: opts.cmd,
      output: output.trim() || '(no output)',
      theme: opts.theme,
    });
    opts.onRender();
  });
  proc.on('error', (err) => {
    entry.component = new OutputBlock({
      command: opts.cmd,
      output: err.message,
      variant: 'error',
      theme: opts.theme,
    });
    opts.onRender();
  });
}

/** Export the current roundtrip history to a JSON file. */
export async function exportContextToFile(opts: {
  args: string;
  roundtrips: RoundtripStore;
  modelId: string | undefined;
  transcript: Transcript;
  onRender: () => void;
  onError: (message: string) => void;
}): Promise<void> {
  const history = opts.roundtrips.all();
  if (history.length === 0) {
    opts.onError('No context available to export.');
    return;
  }

  const outputPath = opts.args.trim() || '.mu/context.json';
  const resolvedPath = resolve(outputPath);
  const payload = {
    exportedAt: new Date().toISOString(),
    model: opts.modelId,
    roundtrips: history,
  };

  try {
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    opts.transcript.lines.push({ role: 'command', content: `/context-export ${outputPath}` });
    opts.transcript.lines.push({ role: 'command_result', content: `saved context to ${outputPath}` });
    opts.onRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts.onError(`Failed to export context: ${message}`);
  }
}

/** Toggle expansion of every OutputBlock in the transcript. */
export function toggleOutputBlocksInTranscript(transcript: Transcript): boolean {
  const blocks = transcript.lines
    .filter((e): e is Extract<typeof e, { role: 'output_block' }> => e.role === 'output_block')
    .map((e) => e.component);
  if (blocks.length === 0) return false;
  const allExpanded = blocks.every((b) => b.expanded);
  for (const b of blocks) b.expanded = !allExpanded;
  return true;
}
