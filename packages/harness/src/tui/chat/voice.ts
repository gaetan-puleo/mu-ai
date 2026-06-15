import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RecorderSpec {
  cmd: string;
  args: (out: string) => string[];
}

const RECORDERS: RecorderSpec[] = [
  {
    cmd: 'ffmpeg',
    args: (
      out,
    ) => ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'pulse', '-i', 'default', '-ac', '1', '-ar', '16000', out],
  },
  { cmd: 'arecord', args: (out) => ['-q', '-f', 'S16_LE', '-c', '1', '-r', '16000', '-t', 'wav', out] },
  { cmd: 'parecord', args: (out) => ['--channels=1', '--rate=16000', '--file-format=wav', out] },
  { cmd: 'pw-record', args: (out) => ['--channels=1', '--rate=16000', out] },
];

const which = (cmd: string): Promise<boolean> =>
  new Promise((res) => {
    const probe = spawn('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    probe.on('error', () => res(false));
    probe.on('exit', (code) => res(code === 0));
  });

export async function detectRecorder(): Promise<RecorderSpec | undefined> {
  for (const rec of RECORDERS) {
    if (await which(rec.cmd)) return rec;
  }
  return undefined;
}

export interface VoiceRecording {
  stop(): Promise<Uint8Array>;
  cancel(): Promise<void>;
  elapsed(): number;
}

export interface StartVoiceOptions {
  recorder: RecorderSpec;
  now: () => number;
}

export async function startRecording(opts: StartVoiceOptions): Promise<VoiceRecording> {
  const dir = await mkdtemp(join(tmpdir(), 'mu-voice-'));
  const out = join(dir, 'rec.wav');
  const started = opts.now();
  const child: ChildProcess = spawn(opts.recorder.cmd, opts.recorder.args(out), { stdio: 'ignore' });

  let spawnError: Error | undefined;
  child.on('error', (err) => {
    spawnError = err instanceof Error ? err : new Error(String(err));
  });

  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);

  const finalize = (): Promise<void> =>
    new Promise((res) => {
      if (child.exitCode !== null || spawnError) {
        res();
        return;
      }
      const timers: ReturnType<typeof setTimeout>[] = [];
      child.once('exit', () => {
        for (const t of timers) clearTimeout(t);
        res();
      });
      child.kill('SIGINT');
      timers.push(setTimeout(() => child.exitCode === null && child.kill('SIGTERM'), 1200));
      timers.push(setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2400));
    });

  return {
    elapsed: () => Math.max(0, Math.floor((opts.now() - started) / 1000)),
    async stop(): Promise<Uint8Array> {
      await finalize();
      if (spawnError) {
        await cleanup();
        throw spawnError;
      }
      try {
        const buf = await readFile(out).catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') return undefined;
          throw err;
        });
        if (!buf || buf.byteLength <= 44) throw new Error('no audio captured (check microphone permissions)');
        return new Uint8Array(buf);
      } finally {
        await cleanup();
      }
    },
    async cancel(): Promise<void> {
      await finalize();
      await cleanup();
    },
  };
}

const SAMPLE_RATE = 16000;

/** Wrap raw little-endian 16-bit mono PCM in a minimal WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

const STREAM_RECORDERS: { cmd: string; args: string[] }[] = [
  {
    cmd: 'ffmpeg',
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'pulse',
      '-i',
      'default',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      's16le',
      'pipe:1',
    ],
  },
  { cmd: 'arecord', args: ['-q', '-f', 'S16_LE', '-c', '1', '-r', '16000', '-t', 'raw'] },
  { cmd: 'parecord', args: ['--channels=1', '--rate=16000', '--format=s16le', '--raw'] },
  { cmd: 'pw-record', args: ['--channels=1', '--rate=16000', '--format=s16', '-'] },
];

export interface StreamingRecorderSpec {
  cmd: string;
  args: string[];
}

export async function detectStreamingRecorder(): Promise<StreamingRecorderSpec | undefined> {
  for (const rec of STREAM_RECORDERS) {
    if (await which(rec.cmd)) return rec;
  }
  return undefined;
}

export interface StreamingRecording {
  stop(): Promise<void>;
}

/**
 * Spawn a recorder streaming raw s16le mono PCM to stdout; each stdout chunk is
 * delivered to `onChunk`. Spawn failures (binary vanished after detection, EACCES…)
 * arrive asynchronously via the child's 'error' event: without a listener Node
 * re-throws them as an uncaught exception that tears down the whole TUI, so we
 * always attach one and forward it to `onError` for graceful degradation.
 */
export function startStreamingRecording(
  recorder: StreamingRecorderSpec,
  onChunk: (pcm: Uint8Array) => void,
  onError?: (err: Error) => void,
): StreamingRecording {
  const child = spawn(recorder.cmd, recorder.args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let spawnError: Error | undefined;
  child.on('error', (err) => {
    spawnError = err instanceof Error ? err : new Error(String(err));
    onError?.(spawnError);
  });
  child.stdout?.on('data', (buf: Buffer) => onChunk(new Uint8Array(buf)));
  return {
    stop: () =>
      new Promise<void>((res) => {
        if (spawnError || child.exitCode !== null) return res();
        const timers: ReturnType<typeof setTimeout>[] = [];
        child.once('exit', () => {
          for (const t of timers) clearTimeout(t);
          res();
        });
        child.kill('SIGINT');
        timers.push(setTimeout(() => child.exitCode === null && child.kill('SIGTERM'), 800));
        timers.push(setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 1600));
      }),
  };
}

export interface RealtimeDictationOptions {
  transcribe: (wav: Uint8Array) => Promise<string>;
  onPartial: (text: string) => void;
  /** New PCM bytes that trigger another transcription pass. Default ~1.5s @ 16k mono s16le. */
  passEveryBytes?: number;
}

export interface RealtimeDictation {
  push(pcm: Uint8Array): void;
  /** Stop, run a final correction pass over all audio, return the full transcript. */
  finish(): Promise<string>;
  cancel(): void;
}

/**
 * Client-driven incremental dictation: accumulates PCM and re-transcribes the whole
 * buffer every `passEveryBytes`, serialized so a slow model simply yields fewer passes.
 * Each partial re-derives the tail, so the latest words self-correct as more audio arrives;
 * `finish()` runs one last full pass.
 */
export function createRealtimeDictation(opts: RealtimeDictationOptions): RealtimeDictation {
  const passEveryBytes = opts.passEveryBytes ?? SAMPLE_RATE * 2 * 1.5;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let bytesAtLastPass = 0;
  let running = false;
  let finishing = false;
  let stopped = false;
  let cancelled = false;
  let finishPromise: Promise<string> | undefined;
  let active: Promise<void> = Promise.resolve();

  const snapshot = (): Uint8Array => {
    const pcm = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      pcm.set(c, off);
      off += c.length;
    }
    return pcmToWav(pcm);
  };

  const kick = (): void => {
    if (running || stopped || finishing) return;
    running = true;
    active = (async () => {
      try {
        while (!stopped && !finishing && total - bytesAtLastPass >= passEveryBytes) {
          bytesAtLastPass = total;
          const text = await opts.transcribe(snapshot());
          if (!stopped && !finishing) opts.onPartial(text.trim());
        }
      } finally {
        running = false;
      }
    })();
  };

  return {
    push: (pcm) => {
      if (stopped || finishing) return;
      chunks.push(pcm);
      total += pcm.length;
      kick();
    },
    // Idempotent: the cached promise means a second finish() (e.g. a re-entrant
    // toggle) returns the same in-flight/resolved transcript instead of firing a
    // duplicate final transcription pass.
    finish: () => {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        finishing = true;
        await active;
        stopped = true;
        if (cancelled || total === 0) return '';
        return (await opts.transcribe(snapshot())).trim();
      })();
      return finishPromise;
    },
    cancel: () => {
      cancelled = true;
      stopped = true;
      finishing = true;
    },
  };
}
