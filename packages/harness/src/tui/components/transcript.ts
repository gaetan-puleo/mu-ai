import type { Component } from 'mu-tui';
import type { ChatContext } from '../types';

export const messagesView = (ctx: ChatContext): Component => ({
  render: (s) => ctx.components.column(ctx.channel.messages.map(ctx.renderMessage)).render(s),
});

export const transcript = (ctx: ChatContext): Component => ctx.components.scrollView(messagesView(ctx));
