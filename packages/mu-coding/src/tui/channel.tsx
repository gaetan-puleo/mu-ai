import { type Channel, type Message, newMessage, type Session } from 'mu-core';
import { safeDispatch } from './dispatchSlot';

const CHANNEL_ID = 'cli';

export interface TuiChannelHandle {
  channel: Channel;
  submit: (text: string) => Promise<void>;
  abort: () => void;
  switchSession: (newSession: Session) => void;
  getSession: () => Session;
}

export function buildTuiChannel(initialSession: Session): TuiChannelHandle {
  let session: Session = initialSession;

  const submit = async (text: string): Promise<void> => {
    const userMsg: Message = newMessage({ role: 'user', content: text, channelId: CHANNEL_ID });
    let lastContent = '';
    let lastReasoning = '';
    for await (const ev of session.run({ userMessage: userMsg })) {
      if (ev.type === 'content') {
        lastContent = ev.text;
        safeDispatch({ type: 'stream_chunk', content: lastContent });
      } else if (ev.type === 'reasoning') {
        lastReasoning = ev.text;
        safeDispatch({ type: 'stream_chunk', reasoning: lastReasoning });
      } else if (ev.type === 'usage') {
        safeDispatch({
          type: 'set_tokens',
          prompt: ev.usage.promptTokens,
          completion: ev.usage.completionTokens,
          total: ev.usage.totalTokens,
        });
      } else if (ev.type === 'turn_end') {
        safeDispatch({ type: 'stream_end' });
        if (ev.error) {
          safeDispatch({
            type: 'toast_push',
            toast: { id: `err-${Date.now()}`, message: ev.error.message, level: 'error' },
          });
        }
      }
    }
  };

  const channel: Channel = {
    id: CHANNEL_ID,
    async start() {
      // The TUI is already mounted; this exists to be addressable for outbound routing.
    },
  };

  return {
    channel,
    submit,
    abort: () => session.abort(),
    switchSession: (next) => {
      session = next;
    },
    getSession: () => session,
  };
}
