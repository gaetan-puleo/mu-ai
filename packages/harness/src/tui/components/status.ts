import type { Component } from 'mu-tui';
import type { ChatContext, ChatStatus } from '../types';

const LABELS: Record<ChatStatus, string> = {
  idle: '\x1b[2m● ready\x1b[0m',
  thinking: '\x1b[33m◍ thinking…\x1b[0m',
  error: '\x1b[31m✗ error\x1b[0m',
};

export const status = (ctx: ChatContext): Component => ({
  render: (s) => ctx.components.text(LABELS[ctx.status.current]).render(s),
});
