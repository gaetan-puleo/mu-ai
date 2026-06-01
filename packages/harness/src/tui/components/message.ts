import type { ContentPart, Message } from 'mu-core';
import type { Component } from 'mu-tui';
import type { ChatContext } from '../types';

export const partToText = (part: ContentPart): string => {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'tool_call':
      return `\x1b[2m[${part.name}]\x1b[0m`;
    case 'tool_result':
      return part.content.map(partToText).join('');
    case 'image':
      return '\x1b[2m[image]\x1b[0m';
    case 'audio':
      return '\x1b[2m[audio]\x1b[0m';
  }
};

const isToolResults = (message: Message): boolean =>
  message.content.length > 0 && message.content.every((part) => part.type === 'tool_result');

const label = (message: Message): string => {
  if (isToolResults(message)) return '\x1b[2mtool\x1b[0m';
  if (message.role === 'user') return '\x1b[36myou\x1b[0m';
  if (message.role === 'assistant') return '\x1b[32magent\x1b[0m';
  return `\x1b[2m${message.role}\x1b[0m`;
};

export const formatMessage = (message: Message): string =>
  `${label(message)}  ${message.content.map(partToText).join('')}`;

export const message = (msg: Message, ctx: ChatContext): Component => ctx.components.text(formatMessage(msg));
