import type { Message } from 'mu-core';
import type { Component, Terminal, TUI } from 'mu-tui';
import type { Channel } from '../channels';
import type { ComponentKit } from './kit';

export type ChatStatus = 'idle' | 'thinking' | 'error';

export interface ChatContext {
  channel: Channel;
  components: ComponentKit;
  renderMessage: (message: Message) => Component;
  status: { current: ChatStatus };
}

export interface ChatParts {
  header: Component;
  transcript: Component;
  status: Component;
  composer: Component;
}

export interface ChatSlots {
  message?: (message: Message, ctx: ChatContext) => Component;
  header?: (ctx: ChatContext) => Component;
  transcript?: (ctx: ChatContext) => Component;
  status?: (ctx: ChatContext) => Component;
  composer?: (ctx: ChatContext) => Component;
  layout?: (parts: ChatParts, ctx: ChatContext) => Component;
}

export interface ChatAppOptions {
  terminal?: Terminal;
  components?: Partial<ComponentKit>;
  slots?: ChatSlots;
  onExit?: () => void;
}

export interface ChatApp {
  readonly tui: TUI;
  start(): void;
  stop(): void;
}
