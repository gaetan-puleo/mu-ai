import { flex, ProcessTerminal, TUI } from 'mu-tui';
import type { Channel } from '../channels';
import { composer, header, message, status, transcript } from './components';
import { defaultKit } from './kit';
import type { ChatApp, ChatAppOptions, ChatContext, ChatParts } from './types';

const defaultLayout = (parts: ChatParts, ctx: ChatContext) =>
  ctx.components.column([parts.header, flex(parts.transcript), parts.status, parts.composer]);

export const createChatApp = (channel: Channel, opts: ChatAppOptions = {}): ChatApp => {
  const slots = opts.slots ?? {};
  const components = { ...defaultKit, ...opts.components };
  const resolveMessage = slots.message ?? message;

  const ctx: ChatContext = {
    channel,
    components,
    renderMessage: (msg) => resolveMessage(msg, ctx),
    status: { current: 'idle' },
  };

  const parts: ChatParts = {
    header: (slots.header ?? header)(ctx),
    transcript: (slots.transcript ?? transcript)(ctx),
    status: (slots.status ?? status)(ctx),
    composer: (slots.composer ?? composer)(ctx),
  };
  const root = (slots.layout ?? defaultLayout)(parts, ctx);

  const terminal = opts.terminal ?? new ProcessTerminal({ bracketedPaste: true, focusEvents: true });
  const tui = new TUI(terminal);

  const unsubscribe = channel.subscribe((event) => {
    if (event.type === 'turn_start') ctx.status.current = 'thinking';
    else if (event.type === 'turn_end') ctx.status.current = 'idle';
    else if (event.type === 'error') ctx.status.current = 'error';
    tui.requestRender();
  });

  tui.setRoot(root);
  tui.setFocus(parts.composer);

  const stop = (): void => {
    unsubscribe();
    tui.stop();
  };

  return {
    tui,
    start: () => {
      tui.addGlobalKeybinding({
        chord: { key: 'c', ctrl: true },
        handler: () => {
          stop();
          opts.onExit?.();
        },
      });
      tui.start();
    },
    stop,
  };
};
