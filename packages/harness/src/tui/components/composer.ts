import type { Component } from 'mu-tui';
import type { ChatContext } from '../types';

export const composer = (ctx: ChatContext): Component => {
  const input = ctx.components.editor({
    placeholder: 'Message…',
    onSubmit: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      input.setValue('');
      void ctx.channel.send(trimmed);
    },
  });
  return input;
};
