import { audio } from 'mu-core';
import type { ModelRegistry } from './models';

const TRANSCRIBE_PROMPT =
  'Transcribe the speech in this audio verbatim. Output only the transcribed words as plain text, with no preamble, quotes, commentary, or translation. If there is no intelligible speech, output nothing.';

export const VOICE_UNAVAILABLE = "voiceModel not configured and the current model doesn't support sound";

export interface VoiceOptions {
  model?: string;
}

export interface VoiceTranscriber {
  transcribe(data: Uint8Array, mime: string): Promise<string>;
  unavailableReason(): Promise<string | undefined>;
}

export const createVoice = (models: ModelRegistry, options: VoiceOptions = {}): VoiceTranscriber => {
  const ref = (): string => {
    if (!options.model) return models.selected;
    if (options.model.includes('/')) return options.model;
    const prefix = models.selected.split('/')[0];
    return `${prefix}/${options.model}`;
  };

  const unavailableReason = async (): Promise<string | undefined> => {
    if (options.model) return undefined;
    const caps = await models.capabilities(ref()).catch(() => undefined);
    return caps?.audio ? undefined : VOICE_UNAVAILABLE;
  };

  return {
    unavailableReason,
    transcribe: async (data, mime) => {
      const reason = await unavailableReason();
      if (reason) throw new Error(reason);
      const { provider, model } = models.resolve(ref());
      const messages = [{
        role: 'user' as const,
        content: [{ type: 'text' as const, text: TRANSCRIBE_PROMPT }, audio(mime, data)],
      }];
      let text = '';
      for await (const event of provider.stream({ model, messages, tools: [] })) {
        if (event.type === 'text') text += event.text;
      }
      return text.trim();
    },
  };
};
