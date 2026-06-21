import { expect, test } from 'vitest';
import type { Provider } from 'mu-core';
import { createModelRegistry } from './models';
import { createVoice, VOICE_UNAVAILABLE } from './voice';

const makeProvider = (audio: boolean): { provider: Provider; calls: string[] } => {
  const calls: string[] = [];
  const provider: Provider = {
    capabilities: () => Promise.resolve({ vision: false, audio }),
    async *stream(req) {
      calls.push(req.model);
      yield { type: 'text', text: 'transcribed text' };
    },
  };
  return { provider, calls };
};

const wav = new Uint8Array([1, 2, 3, 4]);

test('voice: an explicit model is trusted and used verbatim (bare name gets the selected provider prefix)', async () => {
  const { provider, calls } = makeProvider(false);
  const models = createModelRegistry({ providers: { local: provider }, default: 'local/qwen' });
  const voice = createVoice(models, { model: 'gemma-4-12b-qat' });

  expect(await voice.unavailableReason()).toEqual(undefined);
  expect(await voice.transcribe(wav, 'audio/wav')).toEqual('transcribed text');
  expect(calls).toEqual(['gemma-4-12b-qat']);
});

test('voice: falls back to the selected model when none configured and it supports audio', async () => {
  const { provider, calls } = makeProvider(true);
  const models = createModelRegistry({ providers: { local: provider }, default: 'local/gemma-4-e2b' });
  const voice = createVoice(models, {});

  expect(await voice.unavailableReason()).toEqual(undefined);
  expect(await voice.transcribe(wav, 'audio/wav')).toEqual('transcribed text');
  expect(calls).toEqual(['gemma-4-e2b']);
});

test('voice: reports unavailable when not configured and the selected model has no audio support', async () => {
  const { provider } = makeProvider(false);
  const models = createModelRegistry({ providers: { local: provider }, default: 'local/qwen-coder' });
  const voice = createVoice(models, {});

  expect(await voice.unavailableReason()).toEqual(VOICE_UNAVAILABLE);
  await await expect((() => voice.transcribe(wav, 'audio/wav'))()).rejects.toThrow(VOICE_UNAVAILABLE);
});
