import { describe, expect, it } from 'vitest';
import { createRealtimeDictation, pcmToWav, startRecording, startStreamingRecording } from './voice';

const tick = () => new Promise((r) => setTimeout(r, 0));
const asciiAt = (b: Uint8Array, off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len));

const WAV_HEADER = 'RIFF' + ' '.repeat(40);

describe('startRecording', () => {
  it('returns the captured bytes once the recorder finalizes', async () => {
    let clock = 1000;
    const rec = await startRecording({
      now: () => clock,
      recorder: {
        cmd: 'sh',
        args: (out) => ['-c', `trap '' INT TERM; printf '%s' '${WAV_HEADER}extra-audio-bytes' > ${out}`],
      },
    });
    clock = 4000;
    expect(rec.elapsed()).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bytes = await rec.stop();
    expect(bytes.byteLength).toBeGreaterThan(44);
  });

  it('throws when nothing but a header is captured', async () => {
    const rec = await startRecording({
      now: () => 0,
      recorder: { cmd: 'sh', args: (out) => ['-c', `trap '' INT TERM; printf '%s' '${WAV_HEADER}' > ${out}`] },
    });
    await expect(rec.stop()).rejects.toThrow();
  });

  it('discards the recording on cancel without throwing', async () => {
    const rec = await startRecording({
      now: () => 0,
      recorder: { cmd: 'sh', args: (out) => ['-c', `trap '' INT TERM; printf 'x' > ${out}`] },
    });
    await rec.cancel();
  });
});

describe('pcmToWav', () => {
  it('prepends a valid 44-byte WAV header for 16k mono s16le', () => {
    const pcm = new Uint8Array(8);
    const wav = pcmToWav(pcm);
    expect(wav.length).toBe(44 + 8);
    expect(asciiAt(wav, 0, 4)).toBe('RIFF');
    expect(asciiAt(wav, 8, 4)).toBe('WAVE');
    expect(asciiAt(wav, 36, 4)).toBe('data');
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(40, true)).toBe(8); // data size
  });
});

describe('createRealtimeDictation', () => {
  it('re-transcribes the growing buffer each pass and runs a final pass on finish', async () => {
    const seen: number[] = [];
    const partials: string[] = [];
    let calls = 0;
    const dict = createRealtimeDictation({
      passEveryBytes: 4,
      transcribe: (wav) => {
        calls++;
        seen.push(wav.length - 44); // pcm bytes at this pass
        return Promise.resolve(`pass ${calls}`);
      },
      onPartial: (t) => partials.push(t),
    });

    dict.push(new Uint8Array(4)); // crosses threshold → pass over 4 bytes
    await tick();
    dict.push(new Uint8Array(4)); // → pass over 8 bytes
    await tick();

    const final = await dict.finish(); // final pass over all 8 bytes
    expect(partials).toEqual(['pass 1', 'pass 2']);
    expect(seen[0]).toBe(4);
    expect(seen[1]).toBe(8);
    expect(final).toBe(`pass ${calls}`);
    expect(seen[seen.length - 1]).toBe(8);
  });

  it('does not emit partials below the byte threshold but still finishes', async () => {
    const partials: string[] = [];
    const dict = createRealtimeDictation({
      passEveryBytes: 1000,
      transcribe: () => Promise.resolve('final only'),
      onPartial: (t) => partials.push(t),
    });
    dict.push(new Uint8Array(10));
    await tick();
    const final = await dict.finish();
    expect(partials).toEqual([]);
    expect(final).toBe('final only');
  });

  it('emits nothing after cancel', async () => {
    const partials: string[] = [];
    const dict = createRealtimeDictation({
      passEveryBytes: 4,
      transcribe: () => Promise.resolve('x'),
      onPartial: (t) => partials.push(t),
    });
    dict.cancel();
    dict.push(new Uint8Array(8));
    await tick();
    expect(partials).toEqual([]);
  });

  it('finish() is idempotent — concurrent/repeat calls reuse one final pass', async () => {
    let calls = 0;
    const dict = createRealtimeDictation({
      passEveryBytes: 1000,
      transcribe: () => {
        calls++;
        return Promise.resolve(`r${calls}`);
      },
      onPartial: () => {},
    });
    dict.push(new Uint8Array(10));
    const [a, b] = await Promise.all([dict.finish(), dict.finish()]);
    const c = await dict.finish();
    expect([a, b, c]).toEqual(['r1', 'r1', 'r1']);
    expect(calls).toBe(1);
  });
});

describe('startStreamingRecording', () => {
  it('surfaces a spawn failure via onError instead of crashing the process', async () => {
    let captured: Error | undefined;
    const rec = startStreamingRecording(
      { cmd: 'mu-no-such-recorder-binary', args: [] },
      () => {},
      (err) => {
        captured = err;
      },
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(captured).toBeInstanceOf(Error);
    await rec.stop(); // resolves promptly, does not hang
  });
});
